#!/usr/bin/env node
/**
 * Optional native Chrome popup regression check; no account or real profile used.
 * Requires Node 22+ and Playwright + its full Chromium installed locally:
 *   npm install --prefix /tmp/latr-popup-qa playwright
 *   /tmp/latr-popup-qa/node_modules/.bin/playwright install chromium
 *   PLAYWRIGHT_MODULE=/tmp/latr-popup-qa/node_modules/playwright/index.mjs \
 *     node apps/extension/scripts/check-native-popup.mjs [bundle-dir] [evidence-dir]
 * CHROMIUM_EXECUTABLE may point to an existing full Chromium/Chrome for Testing.
 * The default bundle is apps/extension/.output/chrome-mv3-store (package:stores).
 * This opens the actual toolbar popup in a temporary headed browser. A normal
 * tab with an imposed viewport cannot verify intrinsic extension popup sizing.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (typeof WebSocket === "undefined") {
  throw new Error("Native popup QA requires Node 22+ (built-in WebSocket).");
}
const requestedModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const moduleSpecifier = path.isAbsolute(requestedModule)
  ? pathToFileURL(requestedModule).href
  : requestedModule;
let chromium;
try {
  ({ chromium } = await import(moduleSpecifier));
} catch (cause) {
  throw new Error(
    "Install optional Playwright outside the repo and set PLAYWRIGHT_MODULE; see this script's header for commands.",
    { cause }
  );
}
const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const bundle = path.resolve(process.argv[2] || path.join(extensionRoot, ".output/chrome-mv3-store"));
const manifest = JSON.parse(await readFile(path.join(bundle, "manifest.json"), "utf8"));
assert.equal(manifest.action?.default_popup, "popup.html", "Expected a Chrome MV3 extension build");
const evidence = process.argv[3]
  ? path.resolve(process.argv[3])
  : await mkdtemp(path.join(os.tmpdir(), "latr-native-popup-evidence-"));
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "latr-native-popup-profile-"));
let context;
let socket;
let targetTimer;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),
    headless: false,
    viewport: null,
    args: [
      `--disable-extensions-except=${bundle}`,
      `--load-extension=${bundle}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
    ],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const popupURL = `chrome-extension://${extensionId}/popup.html`;
  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  const targetPromise = new Promise((resolve, reject) => {
    const receive = ({ targetInfo }) => {
      if (targetInfo.url === popupURL) resolve(targetInfo);
    };
    cdp.on("Target.targetCreated", receive);
    cdp.on("Target.targetInfoChanged", receive);
    targetTimer = setTimeout(() => reject(new Error("Native action popup target did not appear")), 10_000);
  });
  await worker.evaluate(() => chrome.action.openPopup());
  const target = await targetPromise;
  clearTimeout(targetTimer);

  // Native action popups are excluded from Playwright's context.pages(). Attach
  // directly to the discovered popup target instead of emulating it in a tab.
  const port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
  socket = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${target.targetId}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(JSON.stringify(message.error)));
    else operation.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 35_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const ready = await send("Runtime.evaluate", {
    expression: `new Promise(async resolve => {
      for (let i = 0; i < 300; i++) {
        if (document.querySelector('#loading')?.classList.contains('hidden')) { resolve(true); return; }
        await new Promise(r => setTimeout(r, 100));
      }
      resolve(false);
    })`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(ready.result.value, true, "Popup did not finish signed-out initialization");
  const result = await send("Runtime.evaluate", {
    expression: `JSON.stringify((() => {
      const bounds = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {
        url: location.href, title: document.title, innerWidth, innerHeight,
        rootWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.getBoundingClientRect().width,
        header: bounds('.header'), brand: bounds('.brand'), settings: bounds('#settings'),
        input: bounds('#handle'), button: bounds('#sign-in'),
        signedOut: !document.querySelector('#signed-out').classList.contains('hidden'),
        signedIn: !document.querySelector('#signed-in').classList.contains('hidden'),
      };
    })())`,
    returnByValue: true,
  });
  const metrics = JSON.parse(result.result.value);
  await writeFile(path.join(evidence, "metrics.json"), JSON.stringify(metrics, null, 2));
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(evidence, "popup.png"), Buffer.from(screenshot.data, "base64"));
  console.log(JSON.stringify({ bundle, evidence, metrics }, null, 2));
  assert.equal(metrics.url, popupURL);
  assert.equal(metrics.title, "L@tr.link");
  assert.equal(metrics.signedOut, true);
  assert.equal(metrics.signedIn, false);
  assert.ok(metrics.innerWidth >= 360, "Native popup must be at least 360 CSS pixels wide");
  assert.ok(metrics.scrollWidth <= metrics.innerWidth, "Native popup has horizontal overflow");
  for (const name of ["header", "brand", "settings", "input", "button"]) {
    const box = metrics[name];
    assert.ok(box.width > 0 && box.height > 0, `${name} must be visible`);
    assert.ok(box.left >= 0 && box.right <= metrics.innerWidth, `${name} is clipped horizontally`);
    assert.ok(box.top >= 0 && box.bottom <= metrics.innerHeight, `${name} is clipped vertically`);
  }
  console.log("PASS: Actual native action popup has readable sizing and visible login controls.");
} finally {
  clearTimeout(targetTimer);
  socket?.close();
  try {
    await context?.close();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
