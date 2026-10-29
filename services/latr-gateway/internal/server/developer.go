package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/auth"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/developer"
)

func convertInput(raw map[string]any, target *input) error {
	b, e := json.Marshal(raw)
	if e != nil {
		return invalid("Invalid input")
	}
	if e = json.Unmarshal(b, target); e != nil {
		return invalid("Invalid input field type")
	}
	return nil
}
func routeFamily(path string) string { return developer.RouteFamily(path) }
func clientSummary(c developer.Client) map[string]any {
	out := map[string]any{"clientId": c.ClientID, "kind": "developer", "createdAt": c.CreatedAt}
	if c.DisplayName != nil {
		out["displayName"] = *c.DisplayName
	}
	return out
}
func keySummary(k developer.Key) map[string]any {
	out := map[string]any{"keyId": k.KeyID, "createdAt": k.CreatedAt}
	if k.Label != nil {
		out["label"] = *k.Label
	}
	if k.RevokedAt != nil {
		out["revokedAt"] = *k.RevokedAt
	}
	return out
}
func (s *Server) developerOperation(ctx context.Context, nsid string, a auth.Context, in input, r *http.Request) (any, error) {
	name := nsid[strings.LastIndex(nsid, ".")+1:]
	switch name {
	case "listClients":
		records, e := s.Store.ListClients(ctx, a.DID)
		if e != nil {
			return nil, e
		}
		out := []map[string]any{}
		for _, c := range records {
			out = append(out, clientSummary(c))
		}
		return map[string]any{"clients": out}, nil
	case "createClient":
		c, e := s.Store.CreateClient(ctx, a.DID, in.ClientID, in.DisplayName, false)
		if e != nil {
			return nil, e
		}
		return clientSummary(c), nil
	case "deleteClient":
		e := s.Store.DeleteClient(ctx, a.DID, in.ClientID)
		return ok(), e
	case "listKeys":
		id := in.ClientID
		if id == "" {
			var e error
			id, e = required(r, "clientId")
			if e != nil {
				return nil, e
			}
		}
		keys, e := s.Store.ListAPIKeys(ctx, a.DID, id)
		if e != nil {
			return nil, e
		}
		out := []map[string]any{}
		for _, k := range keys {
			out = append(out, keySummary(k))
		}
		return map[string]any{"keys": out}, nil
	case "createKey":
		k, secret, e := s.Store.CreateAPIKey(ctx, a.DID, in.ClientID, in.Label)
		if e != nil {
			return nil, e
		}
		out := keySummary(k)
		out["clientId"] = k.ClientID
		out["apiKey"] = secret
		return out, nil
	case "revokeKey":
		e := s.Store.RevokeAPIKey(ctx, a.DID, in.ClientID, in.KeyID)
		return ok(), e
	case "getUsage":
		v, e := s.Store.UsageSummaries(ctx, a.DID)
		return map[string]any{"usage": v}, e
	}
	return nil, invalid("Unknown developer operation")
}
