#!/usr/bin/env bun
// Travel Logger QA driver — Playwright with a persistent profile.
//
// Why this exists: the gstack browse tool is non-persistent — every restart
// drops the Authelia session cookie, so we end up re-importing from Chrome
// over and over. Playwright's launchPersistentContext keeps a real on-disk
// profile, so one login is good for the life of the cookie (12h via
// Authelia's session config).
//
// Usage:
//   bun run qa login              # one-time: opens visible browser, you log in
//   bun run qa goto <url>         # navigate (auto-starts headless daemon)
//   bun run qa screenshot [file]  # PNG, default /tmp/travel-qa.png
//   bun run qa click <text-or-css>
//   bun run qa fill <selector> <value>
//   bun run qa eval '<js expr>'   # returns JSON.stringify(result)
//   bun run qa state              # url + title + hash
//   bun run qa console            # buffered console messages
//   bun run qa offline on|off     # toggle Playwright network — for M8 airplane-mode tests
//   bun run qa reload
//   bun run qa show               # open visible window on the daemon's current page
//   bun run qa stop               # kill daemon
//
// The daemon runs on http://127.0.0.1:7891. Storage persists at ./.qa-profile/.

import { chromium, type BrowserContext, type Page, type ConsoleMessage } from 'playwright';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const PROFILE_DIR = join(ROOT, '.qa-profile');
const DAEMON_PORT = 7891;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const BASE_URL = process.env.QA_BASE_URL ?? 'https://travel.myhometech.app';

// ── Entry: dispatch on argv ────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args[0] === '--daemon') {
  await runDaemon();
} else {
  await runClient(args);
}

// ── Client ─────────────────────────────────────────────────────────────────

async function runClient(argv: string[]) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') return printHelp();

  if (cmd === 'login') return runLogin();
  if (cmd === 'show')  return runShow();
  if (cmd === 'stop')  return runStop();

  await ensureDaemon();

  const body = JSON.stringify({ cmd, args: rest });
  const res = await fetch(`${DAEMON_URL}/cmd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const txt = await res.text();
  if (!res.ok) {
    console.error(`error (${res.status}): ${txt}`);
    process.exit(1);
  }
  console.log(txt);
}

function printHelp() {
  const lines = [
    'travel-logger QA driver — see top of scripts/qa.ts for full docs',
    '',
    'commands:',
    '  login                    open visible browser, sign in to Authelia',
    '  goto <url>               navigate (relative URLs resolved against',
    '                           QA_BASE_URL = ' + BASE_URL + ')',
    '  reload                   reload current page',
    '  screenshot [file]        full-page PNG (default /tmp/travel-qa.png)',
    '  click <text-or-css>      click element by visible text or CSS',
    '  fill <selector> <value>  fill input',
    '  press <key>              keyboard key (e.g. Enter, Escape)',
    '  type <text>              type into focused element',
    '  eval <js>                eval in page; prints JSON-stringified result',
    '  state                    url + title + hash',
    '  console                  buffered console messages (last 200)',
    '  offline on|off           toggle network (Playwright setOffline)',
    '  show                     open visible window on the current page',
    '  stop                     kill daemon',
  ];
  console.log(lines.join('\n'));
}

async function runLogin() {
  if (await daemonRunning()) {
    console.error('daemon is running — stop it first: bun run qa stop');
    process.exit(1);
  }
  console.log('opening visible browser; sign in, then close the window or hit Ctrl+C here');
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 414, height: 896 }, // iPhone-ish
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(BASE_URL);
  // Wait until the user navigates to a non-/auth path (= signed in)
  // OR closes the browser.
  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 10 * 60 * 1000 });
    console.log('detected sign-in; saving profile');
    await page.waitForTimeout(500);
  } catch {
    console.log('login wait timed out — closing anyway');
  }
  await ctx.close();
  console.log('done. profile at .qa-profile/. cookies stick until Authelia expires the session (12h).');
}

async function runShow() {
  await ensureDaemon();
  const res = await fetch(`${DAEMON_URL}/show`, { method: 'POST' });
  console.log(await res.text());
}

async function runStop() {
  if (!(await daemonRunning())) {
    console.log('daemon not running');
    return;
  }
  await fetch(`${DAEMON_URL}/stop`, { method: 'POST' }).catch(() => {});
  // Give it a moment to shut down
  await new Promise((r) => setTimeout(r, 200));
  console.log('stopped');
}

async function daemonRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${DAEMON_URL}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureDaemon() {
  if (await daemonRunning()) return;
  if (!existsSync(PROFILE_DIR)) {
    console.error('no profile yet — run `bun run qa login` first to sign in');
    process.exit(1);
  }
  // Spawn detached daemon
  const child = spawn(process.execPath, [process.argv[1]!, '--daemon'], {
    detached: true,
    stdio: 'ignore',
    cwd: ROOT,
  });
  child.unref();
  // Poll for readiness
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (await daemonRunning()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error('daemon failed to start within 8s');
  process.exit(1);
}

// ── Daemon ─────────────────────────────────────────────────────────────────

async function runDaemon() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 414, height: 896 },
  });
  let page = ctx.pages()[0] ?? await ctx.newPage();

  const consoleLogs: { type: string; text: string; ts: string }[] = [];
  const attachConsole = (p: Page) => {
    p.on('console', (msg: ConsoleMessage) => {
      consoleLogs.push({ type: msg.type(), text: msg.text(), ts: new Date().toISOString() });
      if (consoleLogs.length > 200) consoleLogs.shift();
    });
    p.on('pageerror', (err) => {
      consoleLogs.push({ type: 'pageerror', text: String(err.stack || err.message), ts: new Date().toISOString() });
      if (consoleLogs.length > 200) consoleLogs.shift();
    });
  };
  attachConsole(page);

  const server = Bun.serve({
    port: DAEMON_PORT,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      const url = new URL(req.url);

      if (url.pathname === '/health') return new Response('ok');

      if (url.pathname === '/stop') {
        queueMicrotask(async () => {
          await ctx.close().catch(() => {});
          server.stop(true);
          process.exit(0);
        });
        return new Response('stopping');
      }

      if (url.pathname === '/show') {
        // Open a *separate* visible context pointed at the same URL so the
        // user can inspect. Doesn't disturb the headless daemon's page.
        const visible = await chromium.launchPersistentContext(PROFILE_DIR + '-show', {
          headless: false,
          viewport: { width: 414, height: 896 },
        });
        const vp = visible.pages()[0] ?? await visible.newPage();
        await vp.goto(page.url());
        return new Response('opened visible window at ' + page.url());
      }

      if (url.pathname === '/cmd' && req.method === 'POST') {
        const { cmd, args } = (await req.json()) as { cmd: string; args: string[] };
        try {
          const out = await runCmd(page, ctx, cmd, args, consoleLogs);
          return new Response(out);
        } catch (err) {
          return new Response(String((err as Error).message ?? err), { status: 500 });
        }
      }

      return new Response('not found', { status: 404 });
    },
  });

  // Re-attach console listener if the page navigates to a new tab/popup.
  ctx.on('page', (p) => { page = p; attachConsole(p); });

  console.log(`qa daemon ready on ${DAEMON_URL}`);
}

async function runCmd(
  page: Page,
  ctx: BrowserContext,
  cmd: string,
  args: string[],
  consoleLogs: { type: string; text: string; ts: string }[],
): Promise<string> {
  switch (cmd) {
    case 'goto': {
      const target = args[0] ?? '/';
      const url = target.startsWith('http') ? target : BASE_URL + target;
      const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
      return `navigated to ${page.url()} (${res?.status() ?? '?'})`;
    }

    case 'reload': {
      const res = await page.reload({ waitUntil: 'domcontentloaded' });
      return `reloaded ${page.url()} (${res?.status() ?? '?'})`;
    }

    case 'screenshot': {
      const path = args[0] ?? '/tmp/travel-qa.png';
      await page.screenshot({ path, fullPage: true });
      return `screenshot saved: ${path}`;
    }

    case 'click': {
      const target = args.join(' ');
      // Try CSS selector first, then by text
      try {
        await page.locator(target).first().click({ timeout: 3000 });
      } catch {
        await page.getByText(target, { exact: false }).first().click({ timeout: 3000 });
      }
      return `clicked: ${target}`;
    }

    case 'fill': {
      const selector = args[0]!;
      const value = args.slice(1).join(' ');
      await page.locator(selector).fill(value, { timeout: 3000 });
      return `filled ${selector} = ${JSON.stringify(value)}`;
    }

    case 'press': {
      await page.keyboard.press(args[0]!);
      return `pressed ${args[0]}`;
    }

    case 'type': {
      await page.keyboard.type(args.join(' '));
      return `typed`;
    }

    case 'eval': {
      const js = args.join(' ');
      const result = await page.evaluate(`(async () => { return (${js}); })()`);
      return JSON.stringify(result, null, 2);
    }

    case 'state': {
      const state = {
        url: page.url(),
        title: await page.title(),
        hash: await page.evaluate(() => location.hash),
      };
      return JSON.stringify(state, null, 2);
    }

    case 'console': {
      return JSON.stringify(consoleLogs, null, 2);
    }

    case 'wait': {
      const ms = parseInt(args[0] ?? '500', 10);
      await page.waitForTimeout(ms);
      return `waited ${ms}ms`;
    }

    case 'offline': {
      const mode = args[0];
      if (mode !== 'on' && mode !== 'off') {
        throw new Error('usage: offline on|off');
      }
      await ctx.setOffline(mode === 'on');
      return `offline=${mode === 'on'}`;
    }

    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}
