import { expect, test, type Page } from '@playwright/test';

/**
 * Audio is verified by measurement, not by ear: an AnalyserNode on the final output (after mute,
 * mix, EQ and limiter) reports RMS through the test hooks. Desktop project only; the audio graph
 * is the same on every viewport.
 */
test.skip(({ isMobile }) => isMobile, 'audio graph is viewport-independent');

const AUDIBLE = 0.01;
const QUIET = 0.002;
const level = (page: Page) => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.audioLevel() ?? 0);
const mode = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.mode);

/** Highest output level seen over the next `ms`. */
async function peak(page: Page, ms: number): Promise<number> {
  let max = 0;
  for (const end = Date.now() + ms; Date.now() < end;) {
    max = Math.max(max, await level(page));
    if (max > AUDIBLE * 3) break;
    await page.waitForTimeout(40);
  }
  return max;
}

async function quiet(page: Page): Promise<void> {
  await expect.poll(() => level(page), { timeout: 15_000, intervals: [100] }).toBeLessThan(QUIET);
}

// The settings Kyle's browser most likely had when the page played nothing: muted, Fish Notes off.
for (const [name, saved] of Object.entries({
  'fresh profile': null,
  'saved mute, Fish Notes off, faders at zero': {
    muted: true,
    master: 0,
    enabled: { music: false, sfx: false, notes: false },
    volume: { music: 0, ambience: 0, sfx: 0, notes: 0, ui: 0 },
  },
})) {
  test(`every audition button makes sound (${name})`, async ({ page }) => {
    test.setTimeout(150_000);
    if (saved) await page.addInitScript((s) => localStorage.setItem('neonriver2_audio_v2', JSON.stringify(s)), saved);
    await page.goto('/?audition');
    await expect.poll(() => mode(page), { timeout: 20_000 }).toBe('title');
    // Without the music bed, so the motif itself is what gets measured.
    await page.locator('#audition-music').uncheck();
    const cards = page.locator('#audition section');
    await expect(cards).toHaveCount(3);
    for (let card = 0; card < 3; card++) {
      for (const label of ['Catch sequence (32)', 'Variation (33-64)', 'Start sting', 'Speed-up stinger', 'Win fanfare', 'Loss phrase']) {
        await cards.nth(card).getByRole('button', { name: label }).click();
        expect(await peak(page, 4000), `theme ${card + 1}: ${label}`).toBeGreaterThan(AUDIBLE);
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        await quiet(page);
      }
    }
    // The page's own meter shows the same thing the hook measures.
    await cards.nth(2).getByRole('button', { name: 'Start sting' }).click();
    await expect
      .poll(async () => Number(await page.locator('#audition-meter').getAttribute('data-level')), { timeout: 4000 })
      .toBeGreaterThan(AUDIBLE);
    // With the bed switched back on, the music is heard too.
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.locator('#audition-music').check();
    expect(await peak(page, 5000), 'music bed').toBeGreaterThan(AUDIBLE);
  });
}

test('in-game start sting, catch, eel shock and win fanfare each reach the output', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?seed=42');
  await expect.poll(() => mode(page), { timeout: 20_000 }).toBe('title');
  // Beds off and one sound soloed at a time: a level at the output can only be the sound named.
  const solo = (name: string | null) =>
    page.evaluate((n) => {
      window.__THREE_GAME_TEST_HOOKS__?.setAudioBeds(false);
      window.__THREE_GAME_TEST_HOOKS__?.soloAudio(n);
    }, name);
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.fishNotes)).toBe(false);

  await solo('start');
  await page.locator('#btn-start').click();
  await expect.poll(() => mode(page)).toBe('playing');
  expect(await peak(page, 6000), 'start sting').toBeGreaterThan(AUDIBLE);

  // Nothing else is allowed to sound while 'start' is soloed: once the sting has rung out, the
  // night is silent even though fish are being caught and missed.
  await quiet(page);
  expect(await peak(page, 1500), 'other sounds while soloed').toBeLessThan(AUDIBLE);

  await solo('catch');
  const before = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.caught ?? 0);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.spawnAtNet('bluegill'));
  expect(await peak(page, 4000), 'catch').toBeGreaterThan(AUDIBLE);
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.caught ?? 0)).toBeGreaterThan(before);

  // The win, through the real path: one pound short, then a fish in the net.
  await solo('win');
  await quiet(page);
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__?.setWeight(199);
    window.__THREE_GAME_TEST_HOOKS__?.spawnAtNet('koi');
  });
  expect(await peak(page, 6000), 'win fanfare').toBeGreaterThan(AUDIBLE);
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.status)).toBe('won');
  await expect.poll(() => mode(page), { timeout: 20_000 }).toBe('over');

  await solo('eel');
  await page.keyboard.press('Enter');
  await expect.poll(() => mode(page)).toBe('playing');
  await quiet(page);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.spawnAtNet('eel'));
  expect(await peak(page, 4000), 'eel shock').toBeGreaterThan(AUDIBLE);
  await expect.poll(() => mode(page), { timeout: 10_000 }).toBe('over');
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.lossCause)).toBe('eel');

  // Master mute silences the game (but, above, never the audition page).
  await solo(null);
  await page.locator('#btn-mute').click();
  await page.locator('#btn-retry').click();
  await expect.poll(() => mode(page)).toBe('playing');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.spawnAtNet('bluegill'));
  expect(await peak(page, 2500), 'muted').toBeLessThan(QUIET);
  expect(errors).toEqual([]);
});
