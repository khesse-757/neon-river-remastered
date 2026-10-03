import { expect, test, type Page } from '@playwright/test';

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

test('boots, plays through real input, loses to an eel, and retries', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect.poll(() => mode(page), { timeout: 20_000 }).toBe('title');

  // The low-res frame is drawn, palette-locked, and not blank.
  const title = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.paletteReport());
  expect(title?.offPalette).toBe(0);
  expect(title?.colorsUsed ?? 0).toBeGreaterThan(12);

  const mobile = testInfo.project.name.includes('mobile');
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

  // Fish arrive and can be caught.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setAutoplay(true));
  await expect.poll(async () => (await diag(page))?.caught ?? 0, { timeout: 45_000 }).toBeGreaterThan(0);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setAutoplay(false));

  // Pause and resume.
  if (mobile) await page.locator('#btn-pause').tap();
  else await page.keyboard.press('Escape');
  await expect.poll(() => mode(page)).toBe('paused');
  const frozenAt = (await diag(page))?.elapsed;
  await page.waitForTimeout(250);
  expect((await diag(page))?.elapsed).toBe(frozenAt);
  if (mobile) await page.locator('#btn-resume').tap();
  else await page.keyboard.press('Escape');
  await expect.poll(() => mode(page)).toBe('playing');

  // One eel ends the night; retry is one tap.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('loss-eel'));
  await expect.poll(() => mode(page)).toBe('over');
  expect((await diag(page))?.lossCause).toBe('eel');
  await expect(page.locator('#status')).toContainText('eel');
  if (mobile) await page.locator('#btn-retry').tap();
  else await page.keyboard.press('Enter');
  await expect.poll(() => mode(page)).toBe('playing');
  expect((await diag(page))?.caught).toBe(0);

  const play = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.paletteReport());
  expect(play?.offPalette).toBe(0);
  expect((await diag(page))?.renderer.calls ?? 999).toBeLessThanOrEqual(60);

  await testInfo.attach(`${testInfo.project.name}-play`, { body: await page.screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});
