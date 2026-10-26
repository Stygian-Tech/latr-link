# Reproducing the Firefox store package

The Firefox source archive is rooted at the L@tr.link monorepo and contains the extension, its shared `latr-web-client` workspace, the root package manifest, and the pinned Bun lockfile. It also includes the other workspace package manifests so `bun install --frozen-lockfile` sees the same dependency graph; their application source is not required to build the extension.

## Requirements

- Bun 1.3.14
- A POSIX shell with `unzip` and `shasum` or `sha256sum`
- Network access for the initial dependency installation

No local `.env` file or client credential is required for a store build. The checked-in `.env.store` contains explicit empty values, and WXT points Vite at the isolated `store/env` directory, so local development and Production credentials cannot enter the compiled environment object. Store mode uses the Production OAuth metadata and the credential-free `https://latr.link/api/latr-gateway` proxy.

## Build

From the extracted source archive root:

```sh
bun install --frozen-lockfile
bun run --cwd apps/extension package:stores
```

The command writes the submission artifacts, release manifest, and checksums under `apps/extension/.output/store/`.

Upload `latr-link-<version>-firefox-store.zip` directly in the Firefox Add-ons website's add-on package field. This ZIP contains `manifest.json` at its root. Upload `latr-link-<version>-firefox-sources.zip` only in the separate reviewer source-code field; it is not an installable extension. The generated `UPLOAD-README.txt` identifies the exact filenames for this release.

## Focused checks

```sh
bun run --cwd apps/extension prepare:store
bun run --cwd apps/extension typecheck
bun run --cwd apps/extension test
(cd apps/extension && bunx wxt zip -b chrome -m store)
(cd apps/extension && bunx wxt zip -b firefox -m store)
```

The extension version comes from `apps/extension/package.json`. `wxt.config.ts` uses that version for both browser manifests.
