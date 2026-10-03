import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

const diag = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
const mode = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.mode);
const lane = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.net.lane ?? -1);

/** A real touch drag (pointerType "touch") through the browser's input pipeline. */
async function touchDrag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(...from) });
  for (let i = 1; i <= 8; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / 8;
    const y = from[1] + ((to[1] - from[1]) * i) / 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, y) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** The gear and the mute button are on screen, top-left, in every mode. */
async function expectCornerControls(page: Page, where: string): Promise<void> {
  // The corner is the screen's on a phone and the painting's on a wide screen.
  const left = await page.evaluate(() => {
    const { scale, targetW, gridW } = window.__THREE_GAME_DIAGNOSTICS__!.layout;
    const origin = Math.floor((targetW - gridW) / 2);
    return origin > 40 ? (origin * scale) / (window.devicePixelRatio || 1) : 0;
  });
  for (const id of ['#btn-settings', '#btn-mute']) {
    const box = await page.locator(id).boundingBox();
    expect(box, `${id} on ${where}`).not.toBeNull();
    expect(box!.x, `${id} on ${where}`).toBeGreaterThanOrEqual(left);
    expect(box!.x, `${id} on ${where}`).toBeLessThan(left + 120);
    expect(box!.y, `${id} on ${where}`).toBeLessThan(80);
    expect(Math.min(box!.width, box!.height), `${id} on ${where}`).toBeGreaterThanOrEqual(44);
  }
}

test('boots, plays through real input, loses to an eel, and retries', async ({ page }, testInfo) => {
  // Software-rendered CI runners need most of two minutes for this walk through the game.
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect.poll(() => mode(page), { timeout: 20_000 }).toBe('title');

  // The low-res frame is drawn, palette-locked, and not blank.
  const shot = PNG.sync.read(await page.screenshot());
  const buckets = new Set<number>();
  for (let i = 0; i < shot.data.length; i += 4 * 97)
    buckets.add((((shot.data[i] ?? 0) >> 4) << 8) | (((shot.data[i + 1] ?? 0) >> 4) << 4) | ((shot.data[i + 2] ?? 0) >> 4));
  expect(buckets.size).toBeGreaterThan(24);

  await expectCornerControls(page, 'title');
  const mobile = testInfo.project.name.includes('mobile');

  // The mode button on the title cycles Normal -> Zen -> Normal, changes the rule line's promise and is saved.
  const press = (selector: string) => (mobile ? page.locator(selector).tap() : page.locator(selector).click());
  expect((await diag(page))?.gameMode).toBe('normal');
  await press('#btn-mode');
  await expect.poll(async () => (await diag(page))?.gameMode).toBe('zen');
  expect(await page.evaluate(() => localStorage.getItem('neonriver2_mode'))).toBe('zen');
  await expect(page.locator('#btn-mode')).toHaveAttribute('aria-label', /Zen/);
  await press('#btn-mode');
  await expect.poll(async () => (await diag(page))?.gameMode).toBe('normal');
  if (mobile) await page.locator('#btn-start').tap();
  else await page.locator('#btn-start').click();
  await expect.poll(() => mode(page)).toBe('playing');

  // The net answers real input.
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  if (mobile) {
    const y = viewport.height * 0.8;
    await touchDrag(page, [viewport.width * 0.5, y], [viewport.width * 0.15, y]);
    await expect.poll(() => lane(page)).toBeLessThan(0.3);
    await touchDrag(page, [viewport.width * 0.3, y], [viewport.width * 0.9, y]);
    await expect.poll(() => lane(page)).toBeGreaterThan(0.6);
  } else {
    await page.keyboard.down('ArrowLeft');
    await expect.poll(() => lane(page)).toBeLessThan(0.2);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.down('KeyD');
    await expect.poll(() => lane(page)).toBeGreaterThan(0.8);
    await page.keyboard.up('KeyD');
    await page.mouse.move(viewport.width / 2, viewport.height * 0.7);
    await expect.poll(() => lane(page)).toBeGreaterThan(0.35);
    await expect.poll(() => lane(page)).toBeLessThan(0.65);
  }

  await expectCornerControls(page, 'play');

  // Fish arrive and can be caught.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setAutoplay(true));
  await expect.poll(async () => (await diag(page))?.caught ?? 0, { timeout: 45_000 }).toBeGreaterThan(0);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setAutoplay(false));

  // Pause and resume.
  if (mobile) await page.locator('#btn-settings').tap();
  else await page.keyboard.press('Escape');
  await expect.poll(() => mode(page)).toBe('paused');
  const frozenAt = (await diag(page))?.elapsed;
  await page.waitForTimeout(250);
  expect((await diag(page))?.elapsed).toBe(frozenAt);
  await expectCornerControls(page, 'pause');

  // Settings: Fish Notes start off; the Advanced section expands, every control in it is a
  // 44 px target, and a change applies at once and is saved.
  const tap = (selector: string) => (mobile ? page.locator(selector).tap() : page.locator(selector).click());
  expect((await diag(page))?.fishNotes).toBe(false);
  await expect(page.locator('#set-notes')).not.toBeChecked();
  await tap('#set-notes');
  await expect.poll(async () => (await diag(page))?.fishNotes).toBe(true);
  await tap('#set-advanced');
  await expect(page.locator('#set-reset')).toHaveCount(1);
  const sizes = await page
    .locator('#settings-scroll input, #settings-scroll button')
    .evaluateAll((nodes) => nodes.map((n) => [n.id, n.getBoundingClientRect().width, n.getBoundingClientRect().height] as const));
  expect(sizes.length).toBeGreaterThanOrEqual(25);
  for (const [id, w, h] of sizes) expect(Math.min(w, h), id).toBeGreaterThanOrEqual(44);
  if (mobile) {
    // A swipe that starts on a fader scrolls the list and leaves the fader alone; a sideways drag moves it.
    const scroller = page.locator('#settings-scroll');
    const value = () => page.locator('#set-adv-ambience').inputValue();
    await page.locator('#set-adv-ambience').scrollIntoViewIfNeeded();
    const was = await value();
    const top = await scroller.evaluate((node) => node.scrollTop);
    const grip = (await page.locator('#set-adv-ambience-grip').boundingBox())!;
    const gx = grip.x + grip.width * 0.2;
    const gy = grip.y + grip.height / 2;
    await touchDrag(page, [gx, gy], [gx + 6, gy - 160]);
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(top + 60);
    expect(await value()).toBe(was);
    await page.locator('#set-adv-ambience').scrollIntoViewIfNeeded();
    const again = (await page.locator('#set-adv-ambience-grip').boundingBox())!;
    const ay = again.y + again.height / 2;
    await touchDrag(page, [again.x + again.width * 0.7, ay], [again.x + again.width * 0.15, ay + 3]);
    await expect.poll(async () => Number(await value())).toBeLessThan(Number(was) - 20);
  } else {
    // Mouse: clicking the drawn knob position for 25 sets exactly 25.
    await page.locator('#set-adv-ui').scrollIntoViewIfNeeded();
    const grip = (await page.locator('#set-adv-ui-grip').boundingBox())!;
    const texel = grip.width / 68;
    await page.mouse.click(grip.x + (2 + 64 * 0.25) * texel, grip.y + grip.height / 2);
    expect(await page.locator('#set-adv-ui').inputValue()).toBe('25');
  }
  await page.locator('#set-eq').scrollIntoViewIfNeeded();
  await tap('#set-eq');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('neonriver2_audio_v2') ?? '{}') as Record<string, unknown>);
  expect(saved.eq).toBe('warm');
  expect(saved.bass).toBe(3);
  expect((saved.enabled as Record<string, boolean>).notes).toBe(true);
  await page.locator('#set-reset').scrollIntoViewIfNeeded();
  await tap('#set-reset');
  await expect.poll(async () => (await diag(page))?.fishNotes).toBe(false);
  // The whole pause-and-settings screen stays inside the mobile draw-call budget.
  expect((await diag(page))?.renderer.calls ?? 999).toBeLessThan(100);
  await page.locator('#settings-scroll').evaluate((node) => (node.scrollTop = 0));
  if (mobile) await page.locator('#btn-resume').tap();
  else await page.keyboard.press('Escape');
  await expect.poll(() => mode(page)).toBe('playing');

  // Space pauses and resumes, and nothing else, during play.
  if (!mobile) {
    await page.keyboard.press('Space');
    await expect.poll(() => mode(page)).toBe('paused');
    await page.keyboard.press('Space');
    await expect.poll(() => mode(page)).toBe('playing');
  }

  // One eel ends the night; retry is one tap.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('loss-eel'));
  await expect.poll(() => mode(page)).toBe('over');
  expect((await diag(page))?.lossCause).toBe('eel');
  await expectCornerControls(page, 'results');
  await expect(page.locator('#status')).toContainText('eel');
  if (mobile) await page.locator('#btn-retry').tap();
  else await page.keyboard.press('Enter');
  await expect.poll(() => mode(page)).toBe('playing');
  expect((await diag(page))?.caught).toBe(0);

  expect((await diag(page))?.renderer.calls ?? 999).toBeLessThanOrEqual(100);

  // HOME, from the pause panel and from the results, goes back to the title screen; a new night starts from there.
  if (mobile) await page.locator('#btn-settings').tap();
  else await page.keyboard.press('Escape');
  await expect.poll(() => mode(page)).toBe('paused');
  await tap('#btn-home');
  await expect.poll(() => mode(page)).toBe('title');
  await expectCornerControls(page, 'title after home');
  await tap('#btn-start');
  await expect.poll(() => mode(page)).toBe('playing');
  expect((await diag(page))?.caught).toBe(0);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('loss-eel'));
  await expect.poll(() => mode(page)).toBe('over');
  await tap('#btn-home');
  await expect.poll(() => mode(page)).toBe('title');

  await testInfo.attach(`${testInfo.project.name}-play`, { body: await page.screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});
