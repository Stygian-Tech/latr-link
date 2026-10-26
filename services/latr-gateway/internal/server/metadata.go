package server

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

const baseScope = "atproto repo:community.lexicon.bookmarks.bookmark?action=create&action=update&action=delete include:link.latr.authFull repo:link.latr.saved.external?action=delete repo:link.latr.saved.item?action=delete repo:com.latr.saved.external?action=delete repo:com.latr.saved.item?action=delete"

func (s *Server) metadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		respondError(w, problem(405, "invalid_request", "Method not allowed"), false)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/oauth/")
	if name != "client-metadata.json" && name != "extension-client-metadata.json" && name != "latrkit-client-metadata.json" {
		respondError(w, problem(404, "not_found", "Not found"), false)
		return
	}
	host := r.Host
	scheme := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
	if scheme == "" {
		scheme = "https"
		h := host
		if name, _, e := net.SplitHostPort(host); e == nil {
			h = name
		}
		if h == "localhost" || h == "127.0.0.1" || h == "::1" {
			scheme = "http"
		}
	}
	origin := scheme + "://" + host
	redirect := s.Config.OAuthPublicOrigin
	scope := baseScope + " include:app.userinput.authFull blob:*/*"
	clientName := "L@tr.link"
	callback := "/callback"
	if name == "extension-client-metadata.json" {
		scope = baseScope
		clientName = "L@tr.link Extension"
		callback = "/extension/callback"
	}
	if name == "latrkit-client-metadata.json" {
		scope = "atproto"
		clientName = "LatrKit Developer Console"
		redirect = s.Config.OAuthLatrkitPublicOrigin
	}
	if redirect == "" {
		redirect = origin
	}
	redirect = strings.TrimRight(strings.TrimSpace(redirect), "/")
	for _, raw := range []string{origin, redirect} {
		u, e := url.Parse(raw)
		if e != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
			respondError(w, problem(500, "oauth_metadata_invalid", "Invalid public origin for OAuth metadata JSON"), false)
			return
		}
	}
	out := map[string]any{"client_id": origin + "/oauth/" + name, "application_type": "web", "grant_types": []string{"authorization_code", "refresh_token"}, "response_types": []string{"code"}, "redirect_uris": []string{redirect + callback}, "scope": scope, "token_endpoint_auth_method": "none", "dpop_bound_access_tokens": true, "client_name": clientName, "client_uri": origin}
	if name == "extension-client-metadata.json" {
		out["software_id"] = "latr-extension"
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	jsonResponse(w, 200, out)
}
