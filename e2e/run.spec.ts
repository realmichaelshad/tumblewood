import { test, expect, type Page } from '@playwright/test';

type State = { code: string; pieces: number; marbles: number; attract: boolean; running: boolean; beat: boolean; audio: string; S: number; ox: number; oy: number; tray: { kind: string; note: number; x: number; y: number }[] };
type Win = { __tumblewood: { state(): State; pieceCentre(i: number): [number, number] } };

function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => problems.push('failed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
  return problems;
}

async function open(page: Page, query = '') {
  await page.goto(query);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
}

const state = (page: Page) => page.evaluate(() => (window as unknown as Win).__tumblewood.state());
const centre = (page: Page, i: number) => page.evaluate((i) => (window as unknown as Win).__tumblewood.pieceCentre(i), i);

/** Drag with real input: touch points through the DevTools protocol on a phone, the mouse on a desktop. */
async function drag(page: Page, from: [number, number], to: [number, number], touch: boolean) {
  const box = (await page.locator('#toy').boundingBox())!;
  const a = { x: box.x + from[0], y: box.y + from[1] }, b = { x: box.x + to[0], y: box.y + to[1] };
  const steps = 12;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps });
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
}

async function tapCanvas(page: Page, at: [number, number], touch: boolean) {
  const box = (await page.locator('#toy').boundingBox())!;
  if (touch) await page.touchscreen.tap(box.x + at[0], box.y + at[1]);
  else await page.mouse.click(box.x + at[0], box.y + at[1]);
  await page.waitForTimeout(350);
}

const STARTER = 'u1r01l46r0bc53d6ab38g64o72o84';

test('Drop plays: a marble runs, sound starts only after the tap', async ({ page }, info) => {
  const problems = watch(page);
  await open(page);
  expect((await state(page)).audio).toBe('none');
  if (info.project.name === 'phone') await page.locator('#drop').tap(); else await page.locator('#drop').click();
  await page.waitForTimeout(400);
  const s = await state(page);
  expect(s.marbles).toBeGreaterThan(0);
  expect(s.audio).toBe('running');
  // Keep dropping, then stop.
  await page.locator('#beat').click();
  await expect(page.locator('#beat')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(3500);
  expect((await state(page)).marbles).toBeGreaterThan(1);
  await page.locator('#beat').click();
  expect((await state(page)).beat).toBe(false);
  // Mute is visible and works.
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  expect(problems).toEqual([]);
});

test('moving pieces: drag a chime, turn a ramp, take a bell off, add a chime from the tray', async ({ page }, info) => {
  const problems = watch(page);
  const touch = info.project.name === 'phone';
  await open(page);
  const s0 = await state(page);
  const total0 = Number((await page.locator('#kit-total').textContent())!.slice(1));
  // 1. Drag the purple chime (piece 6) to a free spot low on the right.
  const c6 = await centre(page, 6);
  await drag(page, c6, [s0.ox + 8 * s0.S, s0.oy + 7 * s0.S], touch);
  const s1 = await state(page);
  expect(s1.code).not.toBe(s0.code);
  expect(s1.pieces).toBe(s0.pieces);
  expect(new URL(page.url()).searchParams.get('run')).toBe(s1.code);
  // 2. Tap the middle ramp to turn it the other way.
  await tapCanvas(page, await centre(page, 1), touch);
  const s2 = await state(page);
  expect(s2.code).not.toBe(s1.code);
  expect(s2.code.slice(5, 6)).toBe('r');
  // 3. Drag a bell into the parts tray: it comes off the board and the kit price drops by the bell's price.
  const bellIndex = s2.code.slice(2).match(/.{3}/g)!.findIndex((t) => t[0] === 'o');
  const cell = s2.tray.find((t) => t.kind === 'chime')!;
  await drag(page, await centre(page, bellIndex), [cell.x, cell.y], touch);
  const s3 = await state(page);
  expect(s3.pieces).toBe(s2.pieces - 1);
  expect(Number((await page.locator('#kit-total').textContent())!.slice(1))).toBe(total0 - 7);
  // 4. Drag a pink chime out of the tray onto the board.
  const pink = s3.tray.find((t) => t.kind === 'chime' && t.note === 7)!;
  await drag(page, [pink.x, pink.y], [s3.ox + 8 * s3.S, s3.oy + 10.5 * s3.S], touch);
  const s4 = await state(page);
  expect(s4.pieces).toBe(s3.pieces + 1);
  expect(s4.code).toMatch(/[hH]\w\w$/);
  await expect(page.locator('#kit-list')).toContainText('pink');
  // 5. Reload keeps the run.
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  expect((await state(page)).code).toBe(s4.code);
  expect(problems).toEqual([]);
});

test('a shared link opens that run; a broken link falls back to the starter', async ({ page }) => {
  const problems = watch(page);
  await open(page, '?run=u2r12d35o84');
  expect((await state(page)).code).toBe('u2r12d35o84');
  await expect(page.locator('#kit-list')).toContainText('1 ramp');
  await open(page, '?run=nonsense');
  expect((await state(page)).code).toBe(STARTER);
  expect(problems).toEqual([]);
});

test('attract mode plays by itself and hands over on the first input', async ({ page }, info) => {
  const problems = watch(page);
  await open(page, '?attract=1');
  expect((await state(page)).attract).toBe(true);
  await expect(page.locator('.controls')).toBeHidden();
  await page.waitForTimeout(1500);
  expect((await state(page)).marbles).toBeGreaterThan(0);
  const box = (await page.locator('#toy').boundingBox())!;
  if (info.project.name === 'phone') await page.touchscreen.tap(box.x + 20, box.y + box.height / 2); else await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const b = await state(page);
  expect(b.attract).toBe(false);
  expect(b.code).toBe(STARTER);
  await expect(page.locator('.controls')).toBeVisible();
  expect(problems).toEqual([]);
});

test('stops when scrolled away and starts again when back', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'the board stays in view on a wide screen');
  await open(page);
  expect((await state(page)).running).toBe(true);
  await page.evaluate(() => scrollTo(0, document.querySelector('.order')!.getBoundingClientRect().top + scrollY));
  await page.waitForTimeout(400);
  expect((await state(page)).running).toBe(false);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  expect((await state(page)).running).toBe(true);
});

test('works inside a frame, as the portfolio shows it', async ({ page }, info) => {
  const problems = watch(page);
  await page.goto('/e2e/frame.html');
  const frame = page.frameLocator('iframe');
  await frame.locator('#drop').waitFor();
  const f = page.frames().find((fr) => fr.url().includes('/dist/'))!;
  await f.waitForFunction(() => document.documentElement.dataset.ready === '1');
  if (info.project.name === 'phone') await frame.locator('#drop').tap(); else await frame.locator('#drop').click();
  await page.waitForTimeout(500);
  const s = await f.evaluate(() => (window as unknown as Win).__tumblewood.state());
  expect(s.marbles).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});
