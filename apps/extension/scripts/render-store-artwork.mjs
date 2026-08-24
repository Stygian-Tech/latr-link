import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDirectory = join(extensionRoot, "store/assets");
const iconPath = join(extensionRoot, "public/icon/128.png");
mkdirSync(assetsDirectory, { recursive: true });

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function screenshotSvg(browserLabel) {
  return Buffer.from(`
    <svg width="1280" height="800" viewBox="0 0 1280 800" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#eff6ff"/>
          <stop offset="1" stop-color="#dbeafe"/>
        </linearGradient>
        <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#0f172a" flood-opacity="0.18"/>
        </filter>
      </defs>
      <rect width="1280" height="800" fill="url(#bg)"/>
      <circle cx="1120" cy="105" r="210" fill="#bfdbfe" opacity="0.55"/>
      <circle cx="110" cy="730" r="250" fill="#dbeafe" opacity="0.75"/>

      <rect x="88" y="104" width="168" height="34" rx="17" fill="#ffffff" opacity="0.88"/>
      <text x="172" y="126" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#1d4ed8">${escapeXml(browserLabel)}</text>
      <text x="88" y="224" font-family="Arial, sans-serif" font-size="58" font-weight="700" fill="#18181b">Save now.</text>
      <text x="88" y="294" font-family="Arial, sans-serif" font-size="58" font-weight="700" fill="#18181b">Read later.</text>
      <text x="88" y="355" font-family="Arial, sans-serif" font-size="25" fill="#52525b">Capture the page you are viewing,</text>
      <text x="88" y="391" font-family="Arial, sans-serif" font-size="25" fill="#52525b">add the tags you want, and close the tab.</text>

      <g transform="translate(88 465)">
        <circle cx="13" cy="13" r="13" fill="#2563eb"/>
        <path d="M7 13.5l4 4 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="38" y="20" font-family="Arial, sans-serif" font-size="20" fill="#27272a">Optional tags</text>
        <circle cx="13" cy="65" r="13" fill="#2563eb"/>
        <path d="M7 65.5l4 4 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="38" y="72" font-family="Arial, sans-serif" font-size="20" fill="#27272a">AT Protocol sign-in</text>
        <circle cx="13" cy="117" r="13" fill="#2563eb"/>
        <path d="M7 117.5l4 4 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="38" y="124" font-family="Arial, sans-serif" font-size="20" fill="#27272a">Your library, on-protocol</text>
      </g>

      <g filter="url(#shadow)" transform="translate(775 66)">
        <rect width="360" height="668" rx="16" fill="#fafafa"/>
        <rect width="360" height="73" rx="16" fill="#fff"/>
        <rect y="57" width="360" height="16" fill="#fff"/>
        <line x1="0" y1="73" x2="360" y2="73" stroke="#e4e4e7"/>
        <text x="18" y="30" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#18181b">L@tr.link</text>
        <text x="18" y="52" font-family="Arial, sans-serif" font-size="12" fill="#71717a">Save This Page to Your Library</text>

        <text x="18" y="106" font-family="Arial, sans-serif" font-size="12" fill="#3f3f46">https://example.com/a-thoughtful-article</text>
        <text x="18" y="144" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#52525b">Tags  <tspan font-weight="400">(optional)</tspan></text>
        <rect x="18" y="157" width="80" height="27" rx="14" fill="#e4e4e7"/>
        <text x="31" y="175" font-family="Arial, sans-serif" font-size="12" fill="#27272a">Reading  ×</text>
        <rect x="104" y="157" width="88" height="27" rx="14" fill="#e4e4e7"/>
        <text x="117" y="175" font-family="Arial, sans-serif" font-size="12" fill="#27272a">Research  ×</text>
        <rect x="18" y="195" width="324" height="36" rx="6" fill="#fff" stroke="#d4d4d8"/>
        <text x="30" y="218" font-family="Arial, sans-serif" font-size="12" fill="#71717a">Add a tag, then press Enter or comma</text>
        <text x="18" y="251" font-family="Arial, sans-serif" font-size="11" fill="#71717a">Tags may contain spaces. Matching is exact and case-sensitive.</text>

        <rect y="274" width="360" height="146" fill="#eff6ff"/>
        <line x1="0" y1="274" x2="360" y2="274" stroke="#e4e4e7"/>
        <line x1="0" y1="420" x2="360" y2="420" stroke="#e4e4e7"/>
        <text x="18" y="301" font-family="Arial, sans-serif" font-size="11" fill="#3f3f46">When you choose Sign In or Save, L@tr.link sends your</text>
        <text x="18" y="319" font-family="Arial, sans-serif" font-size="11" fill="#3f3f46">account authorization, this page URL, and any tags you add</text>
        <text x="18" y="337" font-family="Arial, sans-serif" font-size="11" fill="#3f3f46">to L@tr.link to save the item and build its preview.</text>
        <text x="18" y="355" font-family="Arial, sans-serif" font-size="11" fill="#3f3f46">The extension does not collect browsing history in the</text>
        <text x="18" y="373" font-family="Arial, sans-serif" font-size="11" fill="#3f3f46">background.</text>
        <text x="18" y="401" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#1d4ed8">Privacy Policy  ·  Support</text>

        <rect x="18" y="448" width="324" height="42" rx="7" fill="#2563eb"/>
        <text x="180" y="475" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#fff">Save Current Tab</text>
        <text x="18" y="532" font-family="Arial, sans-serif" font-size="12" fill="#2563eb">Open Library</text>
        <text x="310" y="532" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="#2563eb">Sign Out</text>
        <line x1="18" y1="507" x2="342" y2="507" stroke="#e4e4e7"/>
      </g>
    </svg>
  `);
}

async function renderScreenshot(browserLabel, outputName) {
  await sharp(screenshotSvg(browserLabel))
    .composite([{ input: iconPath, left: 646, top: 102 }])
    .png()
    .toFile(join(assetsDirectory, outputName));
}

const promoSvg = Buffer.from(`
  <svg width="440" height="280" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="promo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#eff6ff"/>
        <stop offset="1" stop-color="#bfdbfe"/>
      </linearGradient>
    </defs>
    <rect width="440" height="280" fill="url(#promo)"/>
    <text x="194" y="108" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#18181b">L@tr.link</text>
    <text x="194" y="145" font-family="Arial, sans-serif" font-size="18" fill="#3f3f46">Save now. Read later.</text>
    <rect x="194" y="176" width="202" height="35" rx="18" fill="#2563eb"/>
    <text x="295" y="199" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#fff">Your library, everywhere</text>
  </svg>
`);

await Promise.all([
  renderScreenshot("Chrome extension", "chrome-screenshot-1280x800.png"),
  renderScreenshot("Firefox Add-on", "firefox-screenshot-1280x800.png"),
  sharp(promoSvg)
    .composite([{ input: iconPath, left: 42, top: 76 }])
    .png()
    .toFile(join(assetsDirectory, "chrome-small-promo-440x280.png")),
]);
copyFileSync(iconPath, join(assetsDirectory, "icon-128.png"));

console.log(`Store artwork rendered in ${assetsDirectory}`);
