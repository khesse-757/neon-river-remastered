import { THEMES, type Theme } from '../audio/melody';
import type { Game } from '../game/Game';

/**
 * ?audition page: each candidate leitmotif as the 32-step catch sequence, its variation, and its
 * stings and fanfare, so the hook can be chosen by ear. Plain DOM on purpose (a tool, not game UI).
 * It plays at default levels whatever the game's mute and channel switches say, and shows a live
 * level meter of the final output.
 */
export function installAudition(game: Game): void {
  const root = document.createElement('div');
  root.id = 'audition';
  root.setAttribute(
    'style',
    'position:fixed;inset:0;z-index:20;overflow:auto;background:rgba(3,9,17,.94);color:#c5e1e8;font:15px/1.5 system-ui,sans-serif;padding:16px;touch-action:auto;-webkit-user-select:text;user-select:text',
  );
  const audio = game.audio;
  audio.setAudition(true);
  // Wait for the sampled voice, so even the first press is the real instrument.
  const ready = (): Promise<void> => audio.ready();

  const heading = document.createElement('h1');
  heading.textContent = 'Neon River: pick the leitmotif';
  heading.setAttribute('style', 'font-size:20px;margin:0 0 4px;color:#8ff8ff');
  const note = document.createElement('p');
  note.setAttribute('style', 'margin:0 0 12px;color:#99c8cd;max-width:60ch');
  note.textContent =
    'Three original motifs in D hirajoshi at 80 BPM. "Catch sequence" plays the 32 notes a perfect streak would play with Fish Notes on, as steady eighth notes. This page ignores the game\'s mute and sound switches.';
  const label = document.createElement('label');
  label.setAttribute('style', 'display:block;margin:0 0 10px');
  const withMusic = document.createElement('input');
  withMusic.type = 'checkbox';
  withMusic.checked = true;
  withMusic.id = 'audition-music';
  withMusic.addEventListener('change', () => audio.setBeds(withMusic.checked));
  label.append(withMusic, ' play over the music loop');

  // Live level of the final output: proof that sound is leaving the page.
  const meter = document.createElement('div');
  meter.id = 'audition-meter';
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-label', 'Output level');
  meter.setAttribute(
    'style',
    'position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:10px;margin:0 0 14px;padding:8px 0;background:rgba(3,9,17,.94);max-width:640px',
  );
  const track = document.createElement('div');
  track.setAttribute('style', 'flex:1;height:14px;border:1px solid #29bcc2;border-radius:3px;background:#091a27;overflow:hidden');
  const fill = document.createElement('div');
  fill.setAttribute('style', 'height:100%;width:0;background:#39e6ee');
  track.append(fill);
  const readout = document.createElement('span');
  readout.setAttribute('style', 'min-width:16ch;font-variant-numeric:tabular-nums;color:#ffd98a');
  meter.append('Output', track, readout);
  let shown = 0;
  const tick = (): void => {
    if (!root.isConnected) return;
    requestAnimationFrame(tick);
    const rms = audio.level();
    // Fast up, slow down, on a dB scale from -60 to 0.
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const target = Math.min(1, Math.max(0, (db + 60) / 60));
    shown = target > shown ? target : shown + (target - shown) * 0.12;
    fill.style.width = `${(shown * 100).toFixed(1)}%`;
    readout.textContent = audio.state !== 'running' ? 'press a button' : rms < 0.0005 ? 'silent' : `${db.toFixed(0)} dB`;
    meter.setAttribute('aria-valuenow', rms.toFixed(4));
    meter.dataset.level = rms.toFixed(4);
  };
  requestAnimationFrame(tick);
  root.append(heading, note, label, meter);

  const status = document.createElement('p');
  status.setAttribute('style', 'margin:12px 0;color:#ffd98a;font-weight:600');
  const showChoice = (): void => {
    status.textContent = `In use: ${audio.theme.name}. Players can change it under Advanced audio; ?theme=${audio.theme.id} links to it.`;
  };

  const button = (text: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute(
      'style',
      'min-height:44px;margin:0 8px 8px 0;padding:8px 14px;border:1px solid #29bcc2;border-radius:6px;background:#091a27;color:#c5e1e8;font:inherit;cursor:pointer',
    );
    // ready() creates and resumes the AudioContext synchronously inside this click.
    b.addEventListener('click', () => void ready().then(run));
    return b;
  };

  THEMES.forEach((theme: Theme, index) => {
    const card = document.createElement('section');
    card.setAttribute('style', 'border:1px solid #243e48;border-radius:8px;padding:12px;margin:0 0 12px;max-width:640px');
    const title = document.createElement('h2');
    title.setAttribute('style', 'font-size:17px;margin:0 0 8px;color:#ffd98a');
    title.textContent = `${'ABC'[index] ?? '?'}. ${theme.name}`;
    card.append(
      title,
      button('Catch sequence (32)', () => audio.playSequence(theme, 32, 0)),
      button('Variation (33-64)', () => audio.playSequence(theme, 32, 32)),
      button('Start sting', () => audio.playThemeCue(theme, 'startSting')),
      button('Speed-up stinger', () => audio.playThemeCue(theme, 'phaseSting')),
      button('Win fanfare', () => audio.playThemeCue(theme, 'winFanfare')),
      button('Loss phrase', () => audio.playThemeCue(theme, 'lossPhrase')),
      button('Use this one', () => {
        audio.setTheme(theme.id);
        showChoice();
      }),
    );
    root.append(card);
  });

  root.append(
    button('Stop', () => audio.stopCue()),
    button('Close and play', () => {
      audio.stopCue();
      audio.setAudition(false);
      audio.setBeds(true);
      root.remove();
    }),
    status,
  );
  showChoice();
  document.body.append(root);
}
