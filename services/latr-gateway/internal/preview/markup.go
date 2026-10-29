// Package preview resolves public page and AT Protocol previews without viewer credentials.
package preview

import (
	"encoding/json"
	"net/url"
	"path"
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/net/html"
)

type Fields struct {
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Image       string `json:"image,omitempty"`
	SiteName    string `json:"siteName,omitempty"`
	Author      string `json:"author,omitempty"`
}

func (f Fields) HasContent() bool {
	return f.Title != "" || f.Description != "" || f.Image != "" || f.SiteName != "" || f.Author != ""
}
func Merge(a, b Fields) Fields {
	if a.Title == "" {
		a.Title = b.Title
	}
	if a.Description == "" {
		a.Description = b.Description
	}
	if a.Image == "" {
		a.Image = b.Image
	}
	if a.SiteName == "" {
		a.SiteName = b.SiteName
	}
	if a.Author == "" {
		a.Author = b.Author
	}
	return a
}
func HostLabel(raw string) string {
	u, e := url.Parse(raw)
	if e != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}
func HumanizeSlug(s string) string {
	if d, e := url.PathUnescape(s); e == nil {
		s = d
	}
	words := strings.FieldsFunc(s, func(r rune) bool { return r == '-' || r == '_' })
	for i, w := range words {
		r := []rune(w)
		if len(r) > 0 {
			r[0] = unicode.ToUpper(r[0])
			words[i] = string(r)
		}
	}
	return strings.Join(words, " ")
}
func Degraded(raw string) Fields {
	u, e := url.Parse(raw)
	if e != nil {
		return Fields{}
	}
	site := HostLabel(raw)
	title := site
	if p := strings.Trim(u.Path, "/"); p != "" {
		title = HumanizeSlug(path.Base(p))
	}
	return Fields{Title: title, SiteName: site}
}
func Enrich(f Fields, raw string) Fields {
	if f.SiteName == "" {
		f.SiteName = HostLabel(raw)
	}
	if f.Title == "" {
		f.Title = f.SiteName
	}
	return f
}
func WeakTitle(f Fields, raw string) bool {
	t := strings.ToLower(strings.TrimSpace(f.Title))
	if t == "" || t == strings.ToLower(f.SiteName) || t == HostLabel(raw) {
		return true
	}
	switch t {
	case "home", "homepage", "the verge", "verge", "news", "latest":
		return true
	}
	u, e := url.Parse(raw)
	return e == nil && strings.EqualFold(t, HumanizeSlug(path.Base(u.Path)))
}
func Score(f Fields, raw string) int {
	n := 0
	if f.Image != "" {
		n += 4
	}
	if !WeakTitle(f, raw) {
		n += 3
	}
	if f.Description != "" {
		n++
	}
	if f.Author != "" {
		n++
	}
	return n
}

var unicodeEscape = regexp.MustCompile(`(?:\\u[0-9a-fA-F]{4})+`)

func clean(s string) string {
	for range 3 {
		previous := s
		s = unicodeEscape.ReplaceAllStringFunc(s, func(escape string) string {
			var decoded string
			if json.Unmarshal([]byte(`"`+escape+`"`), &decoded) == nil {
				return decoded
			}
			return escape
		})
		s = html.UnescapeString(s)
		if s == previous {
			break
		}
	}
	return strings.Join(strings.Fields(s), " ")
}
func absolute(raw, base string) string {
	u, e := url.Parse(clean(raw))
	if e != nil || raw == "" {
		return ""
	}
	b, e := url.Parse(base)
	if e != nil {
		return ""
	}
	u = b.ResolveReference(u)
	if u.Scheme != "https" && u.Scheme != "http" {
		return ""
	}
	return u.String()
}
func author(s string) string {
	s = clean(s)
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
		return ""
	}
	return s
}
func first(m map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := clean(m[k]); v != "" {
			return v
		}
	}
	return ""
}

type Signals struct{ ExplicitTitle, ExplicitImage bool }

// ParseMarkup uses the head first and only consults document metadata when head fields are missing.
func ParseMarkup(markup, base string, headOnly bool) (Fields, Signals) {
	z := html.NewTokenizer(strings.NewReader(markup))
	head := map[string]string{}
	body := map[string]string{}
	inHead := true
	inTitle := false
	inJSON := false
	var title, jld strings.Builder
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		t := z.Token()
		switch tt {
		case html.StartTagToken, html.SelfClosingTagToken:
			name := strings.ToLower(t.Data)
			a := map[string]string{}
			for _, v := range t.Attr {
				a[strings.ToLower(v.Key)] = v.Val
			}
			if name == "body" {
				inHead = false
			}
			if headOnly && !inHead {
				continue
			}
			m := body
			if inHead {
				m = head
			}
			switch name {
			case "title":
				inTitle = true
			case "script":
				inJSON = strings.EqualFold(a["type"], "application/ld+json")
				jld.Reset()
			case "meta":
				key := strings.ToLower(a["property"])
				if key == "" {
					key = strings.ToLower(a["name"])
				}
				if key != "" && m[key] == "" {
					m[key] = clean(a["content"])
				}
			case "link":
				rel := strings.ToLower(a["rel"])
				if rel == "image_src" && m["image_src"] == "" {
					m["image_src"] = a["href"]
				}
				if rel == "author" && m["link_author"] == "" {
					m["link_author"] = a["title"]
				}
			}
		case html.TextToken:
			if inTitle {
				title.WriteString(t.Data)
			}
			if inJSON {
				jld.WriteString(t.Data)
			}
		case html.EndTagToken:
			switch strings.ToLower(t.Data) {
			case "head":
				inHead = false
			case "title":
				inTitle = false
				if head["document_title"] == "" {
					head["document_title"] = clean(title.String())
				}
				title.Reset()
			case "script":
				if inJSON {
					var v any
					if json.Unmarshal([]byte(jld.String()), &v) == nil {
						if inHead {
							extractLD(v, head)
						} else if !headOnly {
							extractLD(v, body)
						}
					}
					inJSON = false
				}
			}
		}
	}
	f := parseFields(head, base)
	if !headOnly && (f.Title == "" || f.Image == "") {
		f = Merge(f, parseFields(body, base))
	}
	return f, Signals{first(head, "og:title", "twitter:title") != "", first(head, "og:image", "og:image:secure_url", "og:image:url", "twitter:image", "twitter:image:src", "image_src") != ""}
}
func parseFields(m map[string]string, base string) Fields {
	return Fields{Title: first(m, "og:title", "twitter:title", "ld_title", "document_title"), Description: first(m, "og:description", "twitter:description", "description"), Image: absolute(first(m, "og:image", "og:image:secure_url", "og:image:url", "twitter:image", "twitter:image:src", "image_src", "ld_image"), base), SiteName: first(m, "og:site_name"), Author: firstAuthor(m, "og:author", "author", "article:author", "twitter:creator", "dc.creator", "link_author", "ld_author")}
}
func firstAuthor(m map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := author(m[key]); value != "" {
			return value
		}
	}
	return ""
}
func extractLD(v any, m map[string]string) {
	switch x := v.(type) {
	case []any:
		for _, i := range x {
			extractLD(i, m)
		}
	case map[string]any:
		for _, k := range []string{"headline", "title"} {
			if s, ok := x[k].(string); ok && m["ld_title"] == "" {
				m["ld_title"] = clean(s)
			}
		}
		if m["ld_image"] == "" {
			switch img := x["image"].(type) {
			case string:
				m["ld_image"] = img
			case map[string]any:
				m["ld_image"], _ = img["url"].(string)
			case []any:
				if len(img) > 0 {
					if s, ok := img[0].(string); ok {
						m["ld_image"] = s
					}
				}
			}
			if m["ld_image"] == "" {
				m["ld_image"], _ = x["thumbnailUrl"].(string)
			}
		}
		if m["ld_author"] == "" {
			switch a := x["author"].(type) {
			case string:
				m["ld_author"] = a
			case map[string]any:
				m["ld_author"], _ = a["name"].(string)
			case []any:
				if len(a) > 0 {
					if am, ok := a[0].(map[string]any); ok {
						m["ld_author"], _ = am["name"].(string)
					}
				}
			}
		}
		if g, ok := x["@graph"]; ok {
			extractLD(g, m)
		}
	}
}
func CanonicalAtURI(raw string) string {
	raw = clean(raw)
	if !strings.HasPrefix(raw, "at://") {
		return ""
	}
	p := strings.Split(strings.TrimPrefix(raw, "at://"), "/")
	if len(p) < 3 || p[0] == "" || p[1] == "" || strings.Join(p[2:], "/") == "" {
		return ""
	}
	return raw
}
func wrapper(uri string) bool {
	return strings.Contains(uri, "/link.latr.saved.external/") || strings.Contains(uri, "/com.latr.saved.external/")
}
func ExtractAtURI(markup string) string {
	if i := strings.Index(strings.ToLower(markup), "</head>"); i >= 0 {
		markup = markup[:i]
	} else if len(markup) > 300000 {
		markup = markup[:300000]
	}
	z := html.NewTokenizer(strings.NewReader(markup))
	fallback := ""
	for {
		t := z.Next()
		if t == html.ErrorToken {
			break
		}
		if t != html.StartTagToken && t != html.SelfClosingTagToken {
			continue
		}
		token := z.Token()
		key := ""
		if token.Data == "link" {
			key = "href"
		} else if token.Data == "meta" {
			key = "content"
		}
		for _, a := range token.Attr {
			if a.Key == key {
				if uri := CanonicalAtURI(a.Val); uri != "" {
					if !wrapper(uri) {
						return uri
					}
					if fallback == "" {
						fallback = uri
					}
				}
			}
		}
	}
	return fallback
}
