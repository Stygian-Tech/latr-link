import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(extensionRoot, "../..");
const outputRoot = join(extensionRoot, ".output");
const storeOutput = join(outputRoot, "store");
const packageJson = JSON.parse(
  readFileSync(join(extensionRoot, "package.json"), "utf8")
);
const version = packageJson.version;
const bunExecutable = process.versions.bun ? process.execPath : "bun";

function run(command, args, cwd = extensionRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function output(command, args, cwd = extensionRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function walkFiles(directory) {
  const results = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) results.push(...walkFiles(path));
    else results.push(path);
  }
  return results;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pngDimensions(path) {
  const data = readFileSync(path);
  assert(data.subarray(1, 4).toString("ascii") === "PNG", `${path} is not a PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readManifest(directory) {
  return JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
}

function validateManifest(manifest, browserName) {
  assert(manifest.version === version, `${browserName} manifest version does not match package.json`);
  assert(manifest.incognito === "not_allowed", `${browserName} must disable private-window access`);
  assert(!manifest.permissions.includes("tabs"), `${browserName} store package must not request tabs`);

  const hosts = browserName === "Chrome"
    ? manifest.host_permissions
    : manifest.permissions.filter((permission) => permission.includes("://"));
  assert(JSON.stringify(hosts) === JSON.stringify(["https://*/*"]), `${browserName} has unexpected host access`);

  if (browserName === "Chrome") {
    assert(manifest.manifest_version === 3, "Chrome store package must use Manifest V3");
  } else {
    assert(manifest.manifest_version === 2, "Firefox store package must use Manifest V2");
    assert(
      manifest.browser_specific_settings?.gecko?.id === "latr-link@stygian.tech",
      "Firefox add-on ID changed"
    );
    assert(
      manifest.browser_specific_settings?.gecko?.strict_min_version === "142.0",
      "Firefox minimum version changed"
    );
  }
}

function envSecretValues() {
  const values = [];
  for (const name of [".env.development.local", ".env.production.local", ".env.local"]) {
    const path = join(extensionRoot, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(VITE_LATR_GATEWAY_API_KEY|VITE_LATR_GATEWAY_CLIENT_ID)\s*=\s*(.+?)\s*$/);
      if (!match) continue;
      const value = match[2].replace(/^['"]|['"]$/g, "").trim();
      if (value.length >= 8 && !value.includes("your-")) values.push({ name: match[1], value });
    }
  }
  return values;
}

function validateBundle(directory, browserName) {
  const text = walkFiles(directory)
    .filter((path) => /\.(?:html|js|json|css)$/.test(path))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  assert(text.includes("https://latr.link/api/latr-gateway"), `${browserName} does not contain the Production proxy target`);
  assert(text.includes("https://api.latr.link/oauth/extension-client-metadata.json"), `${browserName} does not contain Production OAuth metadata`);
  assert(text.includes("https://latr.link/extension/callback"), `${browserName} does not contain the Production callback`);

  const keyLike = text.match(/\blk_[A-Za-z0-9_-]{16,}\b/);
  assert(!keyLike, `${browserName} appears to contain a gateway API key`);
  for (const secret of envSecretValues()) {
    assert(!text.includes(secret.value), `${browserName} contains the local ${secret.name} value`);
  }
}

function validateSourceArchive(path) {
  const files = output("unzip", ["-Z1", path]).split("\n");
  for (const required of [
    "package.json",
    "bun.lockb",
    "apps/extension/package.json",
    "apps/latrkit-dev/package.json",
    "apps/web/package.json",
    "apps/extension/wxt.config.ts",
    "apps/extension/.env.store",
    "apps/extension/store/env/.env",
    "apps/extension/store/BUILD.md",
    "packages/latr-web-client/package.json",
    "packages/latr-web-client/src/latrGatewayClient.ts",
  ]) {
    assert(files.includes(required), `Firefox sources are missing ${required}`);
  }
  assert(!files.some((file) => file.includes("node_modules/")), "Firefox sources contain node_modules");
  assert(!files.some((file) => file.includes("/.output/") || file.startsWith(".output/")), "Firefox sources contain build output");
  assert(!files.some((file) => /\.env(?:\.[^/]*)?\.local$/.test(file)), "Firefox sources contain a local environment file");
}

assert(output(bunExecutable, ["--version"]) === "1.3.14", "Store packaging requires Bun 1.3.14");
run(bunExecutable, ["x", "wxt", "prepare"]);
run(bunExecutable, ["test"]);
run(bunExecutable, ["run", "typecheck"]);
run(bunExecutable, ["x", "wxt", "zip", "-b", "chrome", "-m", "store"]);
run(bunExecutable, ["x", "wxt", "zip", "-b", "firefox", "-m", "store"]);

const chromeDirectory = join(outputRoot, "chrome-mv3-store");
const firefoxDirectory = join(outputRoot, "firefox-mv2-store");
const chromeZip = join(outputRoot, `latr-link-${version}-chrome-store.zip`);
const firefoxZip = join(outputRoot, `latr-link-${version}-firefox-store.zip`);
const firefoxSources = join(outputRoot, `latr-link-${version}-firefox-sources.zip`);
const listingFiles = ["listing.md", "privacy-data.md", "reviewer-notes.md"];
const artwork = [
  { file: "icon-128.png", width: 128, height: 128 },
  { file: "chrome-small-promo-440x280.png", width: 440, height: 280 },
  { file: "chrome-screenshot-1280x800.png", width: 1280, height: 800 },
  { file: "firefox-screenshot-1280x800.png", width: 1280, height: 800 },
];

validateManifest(readManifest(chromeDirectory), "Chrome");
validateManifest(readManifest(firefoxDirectory), "Firefox");
validateBundle(chromeDirectory, "Chrome");
validateBundle(firefoxDirectory, "Firefox");
validateSourceArchive(firefoxSources);

for (const zip of [chromeZip, firefoxZip, firefoxSources]) {
  run("unzip", ["-tqq", zip]);
}

const sourceIcon = join(extensionRoot, "public/icon/128.png");
assert(sha256(join(chromeDirectory, "icon/128.png")) === sha256(sourceIcon), "Chrome 128px icon differs from source");
assert(sha256(join(firefoxDirectory, "icon/128.png")) === sha256(sourceIcon), "Firefox 128px icon differs from source");
for (const asset of artwork) {
  const dimensions = pngDimensions(join(extensionRoot, "store/assets", asset.file));
  assert(
    dimensions.width === asset.width && dimensions.height === asset.height,
    `${asset.file} has unexpected dimensions`
  );
}

rmSync(storeOutput, { recursive: true, force: true });
mkdirSync(storeOutput, { recursive: true });
mkdirSync(join(storeOutput, "assets"), { recursive: true });
const submissionFiles = [
  ...[chromeZip, firefoxZip, firefoxSources].map((source) => ({
    source,
    destination: basename(source),
  })),
  ...listingFiles.map((file) => ({
    source: join(extensionRoot, "store", file),
    destination: file,
  })),
  ...artwork.map(({ file }) => ({
    source: join(extensionRoot, "store/assets", file),
    destination: `assets/${file}`,
  })),
];
for (const item of submissionFiles) {
  copyFileSync(item.source, join(storeOutput, item.destination));
}

let sourceRevision = null;
try {
  sourceRevision = output("git", ["rev-parse", "HEAD"], repoRoot);
} catch {
  // Source archives intentionally do not require Git metadata.
}

const release = {
  version,
  sourceRevision,
  mode: "store",
  gateway: "https://latr.link/api/latr-gateway",
  oauthClientMetadata: "https://api.latr.link/oauth/extension-client-metadata.json",
  oauthRedirectUri: "https://latr.link/extension/callback",
  artifacts: submissionFiles.map((item) => ({
    file: item.destination,
    sha256: sha256(item.source),
  })),
};
writeFileSync(join(storeOutput, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
writeFileSync(
  join(storeOutput, "SHA256SUMS"),
  `${release.artifacts.map((artifact) => `${artifact.sha256}  ${artifact.file}`).join("\n")}\n`
);

console.log(`Store packages verified in ${storeOutput}`);
