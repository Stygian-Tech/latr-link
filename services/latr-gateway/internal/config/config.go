// Package config preserves the gateway's existing deployment environment contract.
package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                      int
	AppEnv                    string
	PLCURL                    string
	OAuthRequireKnownClient   bool
	RequireClientAPIKey       bool
	OfficialClientCredentials map[string]string
	ClientRegistryPath        string
	ClientRegistrationSecret  string
	OAuthPublicOrigin         string
	OAuthLatrkitPublicOrigin  string
	DatabaseURL               string
	DeveloperStorePath        string
	AppViewBaseURLs           []string
	IdentityBaseURL           string
}

func Load() Config { return FromEnv(os.Getenv) }
func FromEnv(get func(string) string) Config {
	env := strings.ToLower(strings.TrimSpace(get("APP_ENV")))
	switch env {
	case "prod", "dev", "test":
	default:
		env = "local"
	}
	value := func(key, fallback string) string {
		if v := strings.TrimSpace(get(key)); v != "" {
			return v
		}
		return fallback
	}
	policy := func(key string) bool {
		if v := get(key); v != "" {
			return ParseBool(v)
		}
		return env == "prod"
	}
	port, err := strconv.Atoi(value("PORT", "8080"))
	if err != nil {
		port = 8080
	}
	appviews := strings.FieldsFunc(get("LATR_GATEWAY_APPVIEW_URLS"), func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' || r == '\r' })
	for i := range appviews {
		appviews[i] = strings.TrimRight(appviews[i], "/")
	}
	if len(appviews) == 0 {
		appviews = []string{"https://public.api.bsky.app"}
	}
	return Config{Port: port, AppEnv: env, PLCURL: strings.TrimRight(value("PLC_URL", "https://plc.directory"), "/"), OAuthRequireKnownClient: policy("OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT"), RequireClientAPIKey: policy("LATR_GATEWAY_REQUIRE_CLIENT_API_KEY"), OfficialClientCredentials: ParseOfficialCredentials(get("LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS")), ClientRegistryPath: value("LATR_GATEWAY_CLIENT_REGISTRY_PATH", "data/client-registry.json"), ClientRegistrationSecret: strings.TrimSpace(get("LATR_GATEWAY_CLIENT_REGISTRATION_SECRET")), OAuthPublicOrigin: strings.TrimSpace(get("OAUTH_PUBLIC_ORIGIN")), OAuthLatrkitPublicOrigin: strings.TrimSpace(get("OAUTH_LATRKIT_PUBLIC_ORIGIN")), DatabaseURL: strings.TrimSpace(get("DATABASE_URL")), DeveloperStorePath: value("LATR_GATEWAY_DEVELOPER_STORE_PATH", "data/developer-store.json"), AppViewBaseURLs: appviews, IdentityBaseURL: strings.TrimRight(value("LATR_GATEWAY_IDENTITY_URL", "https://bsky.social"), "/")}
}
func ParseBool(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
func ParseOfficialCredentials(v string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == ';' }) {
		if i := strings.IndexAny(part, "=:"); i >= 0 {
			key, val := strings.TrimSpace(part[:i]), strings.TrimSpace(part[i+1:])
			if key != "" && val != "" {
				out[key] = val
			}
		}
	}
	return out
}
