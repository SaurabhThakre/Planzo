#!/usr/bin/env node
"use strict";

// One-time, user-operated Figma sign-in. Never print the session value.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const readline = require("node:readline/promises");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  const bundled = path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
  );
  ({ chromium } = require(bundled));
}

const makeUrl = "https://www.figma.com/make/4tPr5AkQO1g0L1esRvGRjz/Planzo-%E2%80%94-Working-Prototype";
const secretPath = path.join(os.tmpdir(), "planzo-figma-session-secret.txt");

async function main() {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(makeUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await prompt.question("Sign in to Figma in the Chrome window. Once Planzo Make is open, press Return here. ");
    const verifiedPage = await context.newPage();
    await verifiedPage.goto(makeUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await verifiedPage.getByRole("button", { name: "Publish", exact: true }).waitFor({ timeout: 120000 });
    const state = await context.storageState({ indexedDB: true });

    const check = await browser.newContext({ storageState: state });
    try {
      const checkPage = await check.newPage();
      await checkPage.goto(makeUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
      await checkPage.getByRole("button", { name: "Publish", exact: true }).waitFor({ timeout: 120000 });
    } finally {
      await check.close();
    }

    const encoded = zlib.gzipSync(JSON.stringify(state)).toString("base64");
    if (Buffer.byteLength(encoded) > 48000) throw new Error("Figma session exceeds the GitHub secret limit");
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, encoded, { mode: 0o600 });
    fs.chmodSync(secretPath, 0o600);
    console.log(`Session saved to ${secretPath}. Add it to GitHub as FIGMA_STORAGE_STATE_B64, then delete this file.`);
    await context.close();
  } finally {
    prompt.close();
    await browser.close();
  }
}

main().catch(error => { console.error(`Could not prepare Figma session: ${error.message}`); process.exitCode = 1; });
