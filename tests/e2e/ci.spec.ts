import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * The required CI check. One short pass over the things that must never break, on the cheapest
 * picture (`?ci`) with game time fast-forwarded. Everything else (mobile, settings, modes, the
 * gallery, every audio cue) is in the full suite: `npm run test:full`.
 */
const diag = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
const mode = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.mode);
const AUDIBLE = 0.01;

test('loads, catches, pauses, loses to an eel and wins', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/?ci&seed=42');
  await expect.poll(() => mode(page), { timeout: 20_000 }).toBe('title');
  expect((await diag(page))?.quality).toBe(2);

  // The canvas is drawn and not blank.
  const shot = PNG.sync.read(await page.screenshot());
  const buckets = new Set<number>();
  for (let i = 0; i < shot.data.length; i += 4 * 97)
    buckets.add((((shot.data[i] ?? 0) >> 4) << 8) | (((shot.data[i + 1] ?? 0) >> 4) << 4) | ((shot.data[i + 2] ?? 0) >> 4));
  expect(buckets.size).toBeGreaterThan(24);

  // Start a night with the beds off and only the catch sound allowed, so a level at the output
  // can only be a catch.
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks?.setAudioBeds(false);
    hooks?.soloAudio('catch');
  });
  await page.locator('#btn-start').click();
  await expect.poll(() => mode(page)).toBe('playing');

  // One catch, and its sound reaches the output.
  const before = (await diag(page))?.caught ?? 0;
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.spawnAtNet('bluegill'));
  await expect.poll(async () => (await diag(page))?.caught ?? 0, { timeout: 8_000, intervals: [40] }).toBeGreaterThan(before);
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audioPeak ?? 0), { timeout: 8_000, intervals: [40] })
    .toBeGreaterThan(AUDIBLE);

  // From here game time runs 4x; the planning bot keeps the net clear of eels meanwhile.
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks?.soloAudio(null);
    hooks?.setTimeScale(4);
    hooks?.setAutoplay(true);
  });

  // Space pauses and resumes.
  await page.keyboard.press('Space');
  await expect.poll(() => mode(page)).toBe('paused');
  await page.keyboard.press('Space');
  await expect.poll(() => mode(page)).toBe('playing');

  // An eel ends the night.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('loss-eel'));
  expect(await mode(page)).toBe('over');
  expect((await diag(page))?.lossCause).toBe('eel');

  // The win, reached through the hook rather than played to.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('win-results'));
  expect(await mode(page)).toBe('over');
  expect((await diag(page))?.status).toBe('won');
  expect((await diag(page))?.lossCause).toBeNull();

  expect(errors).toEqual([]);
});
