import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  outDir: ".output",
  modules: [],
  manifest: ({ browser, manifestVersion }) => {
    const isMv2 = manifestVersion === 2;
    return {
      name: "L@tr.link",
      short_name: "L@tr",
      description: "Save the Current Page to Your L@tr.link Read-Later Library.",
      version: "0.1.0",
      icons: {
        16: "/icon/16.png",
        32: "/icon/32.png",
        48: "/icon/48.png",
        128: "/icon/128.png",
      },
      permissions: ["activeTab", "storage", "contextMenus", "tabs"],
      host_permissions: [
        "https://latr.link/*",
        "https://testing.latr.link/*",
        "https://api.testing.latr.link/*",
        "https://latr-link-dev-gateway.fly.dev/*",
        "https://latr-link-prod-gateway.fly.dev/*",
        "http://127.0.0.1:8080/*",
        "https://public.api.bsky.app/*",
      ],
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
            },
          }
        : {
            action: {
              default_title: "Save to L@tr.link",
              default_popup: "popup.html",
            },
          }),
    };
  },
});
