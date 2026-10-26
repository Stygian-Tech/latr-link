// Package server exposes the L@tr REST compatibility and canonical XRPC surfaces.
package server

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/pds"
)

type gatewayError struct {
	Status        int
	Code, Message string
}

func (e *gatewayError) Error() string            { return e.Message }
func problem(status int, code, msg string) error { return &gatewayError{status, code, msg} }
func invalid(msg string) error                   { return problem(400, "invalid_request", msg) }
func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func respondError(w http.ResponseWriter, err error, xrpc bool) {
	status, code, message := 500, "internal_error", "Internal server error"
	var e *gatewayError
	var pe *pds.Error
	var typed interface {
		HTTPStatus() int
		ErrorCode() string
	}
	switch {
	case errors.As(err, &e):
		status, code, message = e.Status, e.Code, e.Message
	case errors.As(err, &pe):
		status, code, message = pe.Status, pe.Code, pe.Message
	case errors.As(err, &typed):
		status, code, message = typed.HTTPStatus(), typed.ErrorCode(), err.Error()
	case errors.Is(err, latr.ErrConflict):
		status, code, message = 409, "conflict", "Bookmark changed concurrently"
	case errors.Is(err, latr.ErrNotFound):
		status, code, message = 404, "bookmark_not_found", "Bookmark not found"
	case errors.Is(err, latr.ErrInvalidURL):
		status, code, message = 400, "invalid_url", "Invalid bookmark subject"
	case errors.Is(err, latr.ErrInvalidRecord):
		status, code, message = 502, "pds_record_decode", "Invalid stored bookmark"
	}
	if !xrpc {
		// Swift REST adapters historically expose domain errors using protocol names.
		switch {
		case errors.Is(err, latr.ErrInvalidURL):
			code = "InvalidUrl"
		case errors.Is(err, latr.ErrNotFound):
			code = "BookmarkNotFound"
		case errors.Is(err, latr.ErrConflict):
			code = "Conflict"
		case errors.Is(err, latr.ErrInvalidRecord):
			code = "UpstreamFailure"
		case errors.As(err, &typed) && typed.ErrorCode() == "invalid_request":
			code = "InvalidRequest"
		}
	}
	if xrpc {
		names := map[string]string{"missing_auth": "AuthRequired", "invalid_auth_scheme": "InvalidToken", "invalid_token": "InvalidToken", "invalid_sub": "InvalidToken", "token_expired": "InvalidToken", "unsupported_token_alg": "InvalidToken", "missing_dpop": "InvalidDpop", "invalid_dpop": "InvalidDpop", "invalid_dpop_replay": "InvalidDpop", "missing_client_credential": "ClientAuthRequired", "missing_client_id": "ClientAuthRequired", "invalid_client_credential": "InvalidClient", "invalid_client_id": "InvalidClient", "unknown_client": "InvalidClient", "bookmark_not_found": "BookmarkNotFound", "saved_item_not_found": "SavedItemNotFound", "not_found": "SavedItemNotFound", "invalid_url": "InvalidUrl", "missing_url": "InvalidUrl", "usage_limit_exceeded": "RateLimitExceeded", "pds_error": "UpstreamFailure", "pds_resolve": "UpstreamFailure", "pds_record_decode": "UpstreamFailure", "database_error": "UpstreamFailure", "pds_unauthorized": "InvalidDpop", "invalid_upstream_dpop": "InvalidDpop", "missing_upstream_dpop": "InvalidDpop", "pds_forbidden": "Forbidden", "forbidden": "Forbidden", "client_forbidden": "Forbidden", "conflict": "Conflict", "client_exists": "ClientExists", "client_not_found": "ClientNotFound", "key_not_found": "KeyNotFound", "xrpc_not_supported": "XrpcNotSupported"}
		if n := names[code]; n != "" {
			code = n
		} else {
			code = "InvalidRequest"
		}
		w.Header().Set("Cache-Control", "private, no-store")
		if status == 401 {
			w.Header().Set("WWW-Authenticate", "DPoP")
		}
	}
	jsonResponse(w, status, map[string]string{"error": code, "message": message})
}
func decode(w http.ResponseWriter, r *http.Request, target any, strict bool) error {
	if strict {
		kind, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if e != nil || kind != "application/json" {
			return invalid("Content-Type must be application/json")
		}
	}
	badJSON := func() error {
		if strict {
			return invalid("Invalid JSON input")
		}
		return problem(400, "invalid_json", "Invalid JSON body")
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1048576))
	if strict {
		d.DisallowUnknownFields()
	}
	if e := d.Decode(target); e != nil {
		return badJSON()
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return badJSON()
	}
	return nil
}
func validateQuery(r *http.Request, allowed ...string) error {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return invalid("Invalid query")
	}
	for k, v := range values {
		found := false
		for _, a := range allowed {
			if k == a {
				found = true
			}
		}
		if !found || len(v) != 1 {
			return invalid("Unknown or repeated query parameter: " + k)
		}
	}
	return nil
}
func required(r *http.Request, key string) (string, error) {
	v := strings.TrimSpace(r.URL.Query().Get(key))
	if v == "" {
		return "", invalid(key + " is required")
	}
	return v, nil
}
func intParam(r *http.Request, key string, fallback, min, max int) (int, error) {
	v := strings.TrimSpace(r.URL.Query().Get(key))
	if v == "" {
		return fallback, nil
	}
	n, e := strconv.Atoi(v)
	if e != nil || n < min || n > max {
		return 0, invalid(key + " must be between " + strconv.Itoa(min) + " and " + strconv.Itoa(max))
	}
	return n, nil
}
func bounded(n *int, fallback, min, max int) (int, error) {
	if n == nil {
		return fallback, nil
	}
	if *n < min || *n > max {
		return 0, invalid("limit is out of range")
	}
	return *n, nil
}
func deprecate(w http.ResponseWriter, successor string) {
	w.Header().Set("Deprecation", "true")
	w.Header().Set("Link", "<"+successor+">; rel=\"successor-version\"")
	w.Header().Set("Warning", "299 - \"Deprecated L@tr REST adapter; migrate to XRPC\"")
}
func ok() map[string]bool { return map[string]bool{"ok": true} }
