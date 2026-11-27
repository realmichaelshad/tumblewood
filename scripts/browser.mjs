// One way to launch Chromium for the end-to-end tests, shots, capture and checks.
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * Which Chromium to run. Playwright's own build when it is installed (npx playwright install chromium).
 * Where that build cannot be downloaded, a Chromium that is already on the machine: CHROMIUM_PATH if it is set,
 * otherwise the one a managed cloud container ships with. Returns undefined to let Playwright pick its own.
 */
export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try { if (existsSync(chromium.executablePath())) return undefined; } catch { /* fall through */ }
  for (const p of ['/opt/pw-browsers/chromium']) if (existsSync(p)) return p;
  return undefined;
}

export const LAUNCH = { headless: true, args: ['--autoplay-policy=no-user-gesture-required'], executablePath: chromiumPath() };

export function launch(extraArgs = []) {
  return chromium.launch({ ...LAUNCH, args: [...LAUNCH.args, ...extraArgs] });
}

export const BASE = 'http://127.0.0.1:5414/dist/';

export async function ready(page) {
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
}

/** Step the app clock in capture mode. */
export async function step(page, ms, fps = 60) {
  await page.evaluate(([ms, fps]) => { const n = Math.round((ms / 1000) * fps); for (let i = 0; i < n; i++) window.__step(1000 / fps); }, [ms, fps]);
}
