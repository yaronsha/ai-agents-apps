// The last mile: the real app (production build, service worker included) in Chromium, pointed at
// the simulated worker, with the browser clock at the end of the scenario. It checks that the
// alerts show on screen, then hands every push the worker sent to the app's service worker, the
// way the phone's push service would, and checks that each one became a notification.
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium, type Browser } from "playwright";
import { thLocal } from "./scenario";
import { SIM_TOKEN } from "./worker";
import type { Result } from "./run";

const APP = new URL("../../app/", import.meta.url).pathname;
const DIST = new URL("../.app-dist/", import.meta.url).pathname;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export interface App {
  url: string;
  browser: Browser;
  close(): Promise<void>;
}

export async function startApp(): Promise<App> {
  execFileSync("npx", ["vite", "build", "--outDir", DIST, "--emptyOutDir", "--logLevel", "warn"], { cwd: APP, stdio: "inherit" });
  const server: Server = createServer((req, res) => {
    const path = join(DIST, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
    const file = existsSync(path) && statSync(path).isFile() ? path : join(DIST, "index.html");
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as { port: number };
  const browser = await chromium.launch();
  return {
    url: `http://127.0.0.1:${port}`,
    browser,
    close: async () => {
      await browser.close();
      server.close();
    },
  };
}

export async function checkInBrowser(app: App, workerUrl: URL, r: Result, reports: string): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  const context = await app.browser.newContext({
    locale: "he-IL",
    timezoneId: "Asia/Bangkok",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ["notifications"],
  });
  // Offline: the app may talk only to its own server and the simulated worker. Anything else (map
  // tiles, fonts) is blocked, so a run never depends on, or spends anything at, a real service.
  const local = new Set([new URL(app.url).host, workerUrl.host]);
  await context.route("**/*", (route) => (local.has(new URL(route.request().url()).host) ? route.continue() : route.abort("blockedbyclient")));
  await context.addInitScript(
    ([api, token]) => {
      localStorage.setItem("trip.devApiUrl", api);
      localStorage.setItem("trip.token", token);
    },
    [workerUrl.origin, SIM_TOKEN],
  );
  const page = await context.newPage();
  await page.clock.setFixedTime(thLocal(r.scenario.end));
  const cdp = await context.newCDPSession(page);
  const registrations: string[] = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => {
    for (const reg of e.registrations) if (!reg.isDeleted && !registrations.includes(reg.registrationId)) registrations.push(reg.registrationId);
  });
  await cdp.send("ServiceWorker.enable");

  await page.goto(`${app.url}/#alerts`);
  for (const text of r.scenario.screen ?? []) {
    const found = await page
      .getByText(text, { exact: false })
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    ok &&= found;
    lines.push(`${found ? "✓" : "✗"} alerts screen shows "${text}"`);
  }
  await page.screenshot({ path: `${reports}${r.scenario.id}-alerts.png`, fullPage: true });
  await page.goto(`${app.url}/#today`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${reports}${r.scenario.id}-today.png`, fullPage: true });

  // Push delivery into the installed service worker.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  for (let i = 0; i < 50 && !registrations.length; i++) await page.waitForTimeout(100);
  if (!registrations.length) {
    lines.push("✗ the app's service worker never registered, so pushes could not be delivered");
    await context.close();
    return { ok: false, lines };
  }
  // Headless Chromium has no notification centre to read back, so record what the app's push
  // handler asks to show, then let the real showNotification run.
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await sw.evaluate(() => {
    const g = self as unknown as { registration: ServiceWorkerRegistration; shown: string[] };
    const show = g.registration.showNotification.bind(g.registration);
    g.shown = [];
    g.registration.showNotification = (title: string, opts?: NotificationOptions) => {
      g.shown.push(title);
      return show(title, opts).catch(() => undefined);
    };
  });
  for (const p of r.pushes) {
    await cdp.send("ServiceWorker.deliverPushMessage", { origin: app.url, registrationId: registrations[0], data: JSON.stringify(p.raw) });
  }
  await page.waitForTimeout(500 + 100 * r.pushes.length);
  const shown = await sw.evaluate(() => (self as unknown as { shown: string[] }).shown);
  for (const p of r.pushes) {
    const hit = shown.includes(p.title);
    ok &&= hit;
    lines.push(`${hit ? "✓" : "✗"} push became a notification: "${p.title}"`);
  }
  if (!r.pushes.length) lines.push("no pushes to deliver in this scenario");
  lines.push(`screenshots: ${r.scenario.id}-alerts.png, ${r.scenario.id}-today.png`);
  await context.close();
  return { ok, lines };
}
