package server

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/preview"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A snapshot survives its freshness deadline. Expiry means refresh is due; it
// must never remove the last-known title or image from a saved bookmark.
type previewSnapshot struct {
	Fields     preview.Fields
	FreshUntil time.Time
}
type previewSnapshotStore interface {
	Read(context.Context, string) (*previewSnapshot, error)
	Write(context.Context, string, preview.Fields) error
}
type postgresPreviewSnapshots struct{ pool *pgxpool.Pool }

func (p postgresPreviewSnapshots) Read(ctx context.Context, subject string) (*previewSnapshot, error) {
	var snapshot previewSnapshot
	var title, description, image, site, author *string
	err := p.pool.QueryRow(ctx, `SELECT title, description, image_url, site_name, author, expires_at FROM bookmark_previews WHERE subject_hash=$1`, latr.Fingerprint(subject)).Scan(&title, &description, &image, &site, &author, &snapshot.FreshUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if title != nil {
		snapshot.Fields.Title = *title
	}
	if description != nil {
		snapshot.Fields.Description = *description
	}
	if image != nil {
		snapshot.Fields.Image = *image
	}
	if site != nil {
		snapshot.Fields.SiteName = *site
	}
	if author != nil {
		snapshot.Fields.Author = *author
	}
	return &snapshot, nil
}
func (p postgresPreviewSnapshots) Write(ctx context.Context, subject string, f preview.Fields) error {
	f = nonblankPreviewFields(f)
	// Preserve each nonempty saved field when a provider returns a partial result.
	// The atomic SQL merge also protects against concurrent refresh completions.
	_, err := p.pool.Exec(ctx, `INSERT INTO bookmark_previews(subject_hash,subject,title,description,image_url,site_name,author,updated_at,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()+INTERVAL '7 days')
 ON CONFLICT(subject_hash) DO UPDATE SET subject=EXCLUDED.subject,
 title=COALESCE(NULLIF(BTRIM(EXCLUDED.title),''),bookmark_previews.title),
 description=COALESCE(NULLIF(BTRIM(EXCLUDED.description),''),bookmark_previews.description),
 image_url=COALESCE(NULLIF(BTRIM(EXCLUDED.image_url),''),bookmark_previews.image_url),
 site_name=COALESCE(NULLIF(BTRIM(EXCLUDED.site_name),''),bookmark_previews.site_name),
 author=COALESCE(NULLIF(BTRIM(EXCLUDED.author),''),bookmark_previews.author),
 updated_at=NOW(),expires_at=NOW()+INTERVAL '7 days'`, latr.Fingerprint(subject), subject, f.Title, f.Description, f.Image, f.SiteName, f.Author)
	return err
}
func mergePreviewSnapshot(incoming, existing preview.Fields) preview.Fields {
	for _, pair := range [][2]*string{{&incoming.Title, &existing.Title}, {&incoming.Description, &existing.Description}, {&incoming.Image, &existing.Image}, {&incoming.SiteName, &existing.SiteName}, {&incoming.Author, &existing.Author}} {
		if strings.TrimSpace(*pair[0]) == "" {
			*pair[0] = *pair[1]
		}
	}
	return incoming
}
func (s *Server) readPreviewSnapshot(ctx context.Context, subject string) (*previewSnapshot, error) {
	if s.snapshotStore != nil {
		return s.snapshotStore.Read(ctx, subject)
	}
	s.mu.RLock()
	value, ok := s.previews[subject]
	s.mu.RUnlock()
	if !ok {
		return nil, nil
	}
	return &value, nil
}
func (s *Server) cachedSnapshot(ctx context.Context, subject string) (*preview.Fields, bool) {
	snapshot, err := s.readPreviewSnapshot(ctx, subject)
	if err != nil || snapshot == nil || !hasPreviewSnapshotContent(snapshot.Fields) {
		return nil, false
	}
	return &snapshot.Fields, time.Now().Before(snapshot.FreshUntil)
}
func (s *Server) enrichViewChecked(ctx context.Context, v *latr.View) error {
	if v == nil {
		return nil
	}
	subject, _ := v.Value["subject"].(string)
	snapshot, err := s.readPreviewSnapshot(ctx, subject)
	if err != nil {
		return problem(503, "preview_store_unavailable", "Could not read saved preview metadata")
	}
	if snapshot != nil && hasPreviewSnapshotContent(snapshot.Fields) {
		v.Preview = fieldsMap(&snapshot.Fields)
	}
	if snapshot == nil || !hasPreviewSnapshotContent(snapshot.Fields) || !time.Now().Before(snapshot.FreshUntil) {
		s.queuePreview(subject)
	}
	return nil
}
func (s *Server) cached(ctx context.Context, subject string) *preview.Fields {
	fields, _ := s.cachedSnapshot(ctx, subject)
	return fields
}
func (s *Server) cache(ctx context.Context, subject string, fields preview.Fields) error {
	// Resolver fallback labels are display placeholders, not publisher metadata.
	// Failed requests and sparse responses must not replace a real saved title.
	if preview.WeakTitle(fields, subject) {
		fields.Title = ""
	}
	if strings.EqualFold(strings.TrimSpace(fields.SiteName), preview.HostLabel(subject)) {
		fields.SiteName = ""
	}

	// A wholly empty/failed fetch is not a replacement snapshot or a refresh.
	if !hasPreviewSnapshotContent(fields) {
		return nil
	}
	if s.snapshotStore != nil {
		return s.snapshotStore.Write(ctx, subject, fields)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := s.previews[subject]
	s.previews[subject] = previewSnapshot{Fields: mergePreviewSnapshot(fields, previous.Fields), FreshUntil: time.Now().Add(7 * 24 * time.Hour)}
	return nil
}
func (s *Server) durablyCacheMigrationPreview(ctx context.Context, subject string, fields preview.Fields) error {
	if !hasPreviewSnapshotContent(fields) {
		return nil
	}
	// Ephemeral local previews cannot justify deleting the only on-protocol copy.
	if s.snapshotStore == nil {
		return problem(503, "preview_store_unavailable", "A durable preview store is required before retiring legacy metadata")
	}
	if err := s.snapshotStore.Write(ctx, subject, fields); err != nil {
		return problem(503, "preview_store_unavailable", "Could not preserve legacy preview metadata; migration was not applied")
	}
	return nil
}

func hasPreviewSnapshotContent(f preview.Fields) bool {
	return strings.TrimSpace(f.Title) != "" || strings.TrimSpace(f.Description) != "" || strings.TrimSpace(f.Image) != "" || strings.TrimSpace(f.SiteName) != "" || strings.TrimSpace(f.Author) != ""
}

func nonblankPreviewFields(f preview.Fields) preview.Fields {
	for _, value := range []*string{&f.Title, &f.Description, &f.Image, &f.SiteName, &f.Author} {
		if strings.TrimSpace(*value) == "" {
			*value = ""
		}
	}
	return f
}
func (p postgresPreviewSnapshots) ReadMany(ctx context.Context, subjects []string) (map[string]previewSnapshot, error) {
	out := map[string]previewSnapshot{}
	if len(subjects) == 0 {
		return out, nil
	}
	hashes := make([]string, 0, len(subjects))
	for _, subject := range subjects {
		hashes = append(hashes, latr.Fingerprint(subject))
	}
	rows, err := p.pool.Query(ctx, `SELECT subject,title,description,image_url,site_name,author,expires_at FROM bookmark_previews WHERE subject_hash=ANY($1)`, hashes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var subject string
		var snapshot previewSnapshot
		var title, description, image, site, author *string
		if err := rows.Scan(&subject, &title, &description, &image, &site, &author, &snapshot.FreshUntil); err != nil {
			return nil, err
		}
		if title != nil {
			snapshot.Fields.Title = *title
		}
		if description != nil {
			snapshot.Fields.Description = *description
		}
		if image != nil {
			snapshot.Fields.Image = *image
		}
		if site != nil {
			snapshot.Fields.SiteName = *site
		}
		if author != nil {
			snapshot.Fields.Author = *author
		}
		out[subject] = snapshot
	}
	return out, rows.Err()
}
func (s *Server) enrichViews(ctx context.Context, views []latr.View) error {
	subjects := make([]string, 0, len(views))
	for _, view := range views {
		subject, _ := view.Value["subject"].(string)
		subjects = append(subjects, subject)
	}
	snapshots := map[string]previewSnapshot{}
	if batch, ok := s.snapshotStore.(interface {
		ReadMany(context.Context, []string) (map[string]previewSnapshot, error)
	}); ok {
		values, err := batch.ReadMany(ctx, subjects)
		if err != nil {
			return problem(503, "preview_store_unavailable", "Could not read saved preview metadata")
		}
		snapshots = values
	} else if s.snapshotStore != nil {
		for _, subject := range subjects {
			snapshot, err := s.snapshotStore.Read(ctx, subject)
			if err != nil {
				return problem(503, "preview_store_unavailable", "Could not read saved preview metadata")
			}
			if snapshot != nil {
				snapshots[subject] = *snapshot
			}
		}
	} else {
		s.mu.RLock()
		for _, subject := range subjects {
			if snapshot, ok := s.previews[subject]; ok {
				snapshots[subject] = snapshot
			}
		}
		s.mu.RUnlock()
	}
	now := time.Now()
	for i := range views {
		subject := subjects[i]
		snapshot, ok := snapshots[subject]
		if ok && hasPreviewSnapshotContent(snapshot.Fields) {
			views[i].Preview = fieldsMap(&snapshot.Fields)
		}
		if !ok || !hasPreviewSnapshotContent(snapshot.Fields) || !now.Before(snapshot.FreshUntil) {
			s.queuePreview(subject)
		}
	}
	return nil
}
