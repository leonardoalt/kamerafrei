#!/usr/bin/env node
/* Drive the real UI headlessly via the Chrome DevTools Protocol: load a page,
 * evaluate JS expressions in order (promises awaited), print results as JSON
 * lines. Lets us test click handlers and DOM state, not just page loads.
 *
 * Usage:
 *   node scripts/ui_probe.mjs <url> "<expr>" ["<expr>" ...]
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, ...exprs] = process.argv.slice(2);
if (!url || !exprs.length) {
  console.error("usage: ui_probe.mjs <url> <expr...>");
  process.exit(2);
}

const port = 9200 + Math.floor(performance.now() % 500);
const profile = mkdtempSync(join(tmpdir(), "kf-probe-"));
const chrome = spawn(
  "chromium",
  [
    "--headless",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    url,
  ],
  { stdio: "ignore" }
);

const cleanup = () => {
  chrome.kill();
  rmSync(profile, { recursive: true, force: true });
};
process.on("exit", cleanup);

// wait for the debugger endpoint and the page target
let page = null;
for (let i = 0; i < 50 && !page; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    page = targets.find((t) => t.type === "page" && t.url.startsWith(url.split("#")[0]));
  } catch {
    /* not up yet */
  }
}
if (!page) {
  console.error("could not attach to page");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

for (const expression of exprs) {
  if (expression.startsWith("SCREENSHOT:")) {
    const file = expression.slice("SCREENSHOT:".length);
    const resp = await send("Page.captureScreenshot", { format: "png" });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, Buffer.from(resp.result.data, "base64"));
    console.log(JSON.stringify({ screenshot: file }));
    continue;
  }
  const resp = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const r = resp.result;
  if (r?.exceptionDetails) {
    console.log(JSON.stringify({ error: r.exceptionDetails.exception?.description }));
  } else {
    console.log(JSON.stringify(r?.result?.value ?? null));
  }
}
process.exit(0);
