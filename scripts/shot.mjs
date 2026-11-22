// Headless screenshot of the game, for checking visual changes without a screen
// (Claude Code cloud sessions). Needs `npm install` (playwright-core) and a Chrome.
//
//   node scripts/shot.mjs [query] [--out file.png] [--size 1280x720] [--wait s] [--step s]
//
// query    URL flags, default "race=meadow&dev=1&fresh=1&nosplash=1"
// --out    PNG path, default output/shot.png (output/ is git-ignored)
// --size   viewport, default 1280x720 (use 390x844 for an upright phone)
// --wait   seconds to let the page run before the shot, default 2
// --step   seconds of game time to advance with window.__game.step first
//
// Prints page errors and console errors; exits 1 if the page threw.
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { serve } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = opt('--out', 'output/shot.png');
const [w, h] = opt('--size', '1280x720').split('x').map(Number);
const wait = Number(opt('--wait', '2'));
const step = Number(opt('--step', '0'));
const query = (args[0] || 'race=meadow&dev=1&fresh=1&nosplash=1').replace(/^\?/, '');

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('shot: playwright-core missing; run `npm install` (or scripts/bootstrap.sh)');
  process.exit(2);
}

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try { return execSync(`command -v ${bin}`, { encoding: 'utf8' }).trim(); } catch {}
  }
  return undefined; // fall back to Playwright's own downloaded Chromium
}

const server = await serve(0);
const port = server.address().port;
const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
let threw = false;
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => { threw = true; console.error('pageerror:', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'load' });
  if (step > 0) await page.evaluate((s) => window.__game && window.__game.step(s), step);
  await page.waitForTimeout(wait * 1000);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`shot: ${out} (${w}x${h}, ?${query})`);
} finally {
  await browser.close();
  server.close();
}
process.exit(threw ? 1 : 0);
