package config

import "testing"

func TestDeploymentDefaults(t *testing.T) {
	for _, env := range []string{"local", "dev", "test", "prod"} {
		t.Run(env, func(t *testing.T) {
			cfg := FromEnv(func(key string) string {
				if key == "APP_ENV" {
					return env
				}
				return ""
			})
			if cfg.RequireClientAPIKey != (env == "prod") || cfg.OAuthRequireKnownClient != (env == "prod") {
				t.Fatal("credential policy defaults changed")
			}
			if cfg.IdentityBaseURL != "https://bsky.social" || cfg.Port != 8080 || cfg.PLCURL != "https://plc.directory" {
				t.Fatalf("wrong defaults: %+v", cfg)
			}
		})
	}
}
func TestEnvironmentOverrides(t *testing.T) {
	values := map[string]string{"APP_ENV": "prod", "OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT": "false", "LATR_GATEWAY_REQUIRE_CLIENT_API_KEY": "0", "LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS": "first=abc==; second:xyz=", "LATR_GATEWAY_APPVIEW_URLS": "https://one/, https://two/\nhttps://three"}
	cfg := FromEnv(func(key string) string { return values[key] })
	if cfg.RequireClientAPIKey || cfg.OAuthRequireKnownClient || cfg.OfficialClientCredentials["first"] != "abc==" || cfg.OfficialClientCredentials["second"] != "xyz=" || len(cfg.AppViewBaseURLs) != 3 || cfg.AppViewBaseURLs[0] != "https://one" {
		t.Fatalf("bad environment parse: %+v", cfg)
	}
}
