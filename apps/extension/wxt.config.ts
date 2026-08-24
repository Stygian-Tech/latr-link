import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "wxt";

const packageVersion = (
  JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8")
  ) as { version: string }
).version;
const isStoreBuild = process.argv.some(
  (argument, index, argumentsList) =>
    argument === "--mode=store" ||
    argument === "-m=store" ||
    ((argument === "--mode" || argument === "-m") &&
      argumentsList[index + 1] === "store")
);
if (isStoreBuild) {
  for (const variableName of [
    "VITE_LATR_GATEWAY_URL",
    "VITE_LATR_APP_ENV",
    "VITE_LATR_GATEWAY_CLIENT_ID",
    "VITE_LATR_GATEWAY_API_KEY",
    "VITE_ATPROTO_CLIENT_ID",
    "VITE_ATPROTO_REDIRECT_URI",
    "VITE_LATR_WEB_URL",
  ]) {
    delete process.env[variableName];
  }
}

export default defineConfig({
  srcDir: "src",
  outDir: ".output",
  modules: [],
  vite: () => ({
    // Vite otherwise loads .env.production.local during a production bundle,
    // even when WXT's release mode is "store".
    ...(isStoreBuild
      ? {
          envDir: fileURLToPath(new URL("./store/env", import.meta.url)),
          resolve: {
            alias: [
              {
                find: "latr-web-client/latrGatewayConfig",
                replacement: fileURLToPath(
                  new URL("./src/lib/storeLatrGatewayConfig.ts", import.meta.url)
                ),
              },
            ],
          },
        }
      : {}),
  }),
  zip: {
    name: "latr-link",
    artifactTemplate: "{{name}}-{{version}}-{{browser}}-{{mode}}.zip",
    sourcesTemplate: "{{name}}-{{version}}-{{browser}}-sources.zip",
    sourcesRoot: "../..",
    includeSources: [
      "package.json",
      "bun.lockb",
      "apps/extension/package.json",
      "apps/latrkit-dev/package.json",
      "apps/web/package.json",
      "apps/extension/tsconfig.json",
      "apps/extension/wxt.config.ts",
      "apps/extension/.env.example",
      "apps/extension/.env.store",
      "apps/extension/public/**",
      "apps/extension/scripts/**",
      "apps/extension/src/**",
      "apps/extension/store/**",
      "apps/extension/store/env/README.md",
      "packages/latr-web-client/package.json",
      "packages/latr-web-client/tsconfig.json",
      "packages/latr-web-client/src/**",
    ],
    excludeSources: ["**/*"],
  },
  manifest: ({ browser, manifestVersion, mode }) => {
    const isMv2 = manifestVersion === 2;
    const isStore = mode === "store";
    const icons = {
      16: "/icon/16.png",
      32: "/icon/32.png",
      48: "/icon/48.png",
      128: "/icon/128.png",
    };
    return {
      name: "L@tr.link",
      short_name: "L@tr",
      description: "Save the Current Page to Your L@tr.link Read-Later Library.",
      version: packageVersion,
      icons,
      permissions: [
        "activeTab",
        "storage",
        "contextMenus",
        ...(isStore ? [] : ["tabs"]),
      ],
      host_permissions: [
        "https://*/*",
        ...(isStore ? [] : ["http://127.0.0.1:8080/*"]),
      ],
      ...(isStore ? { incognito: "not_allowed" as const } : {}),
      ...(browser === "firefox"
        ? {
            browser_specific_settings: {
              gecko: {
                id: "latr-link@stygian.tech",
                strict_min_version: isStore ? "142.0" : "140.0",
                data_collection_permissions: {
                  required: ["authenticationInfo", "browsingActivity"],
                },
              },
            },
          }
        : {}),
      ...(browser === "safari"
        ? {}
        : {
            commands: {
              "save-current-tab": {
                description: "Save current tab to L@tr.link",
                suggested_key: {
                  default: "Ctrl+Shift+L",
                  mac: "Command+Shift+L",
                },
              },
            },
          }),
      ...(isMv2
        ? {
            browser_action: {
              default_title: "Save to L@tr.link",
              default_popup: "popup.html",
              default_icon: icons,
            },
          }
        : {
            action: {
              default_title: "Save to L@tr.link",
              default_popup: "popup.html",
              default_icon: icons,
            },
          }),
    };
  },
});
