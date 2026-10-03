import { THEMES, type Theme } from '../audio/melody';
import type { Game } from '../game/Game';

/**
 * Dev-only ?audition page: each candidate leitmotif as the 32-step catch sequence, its variation,
 * and its stings and fanfare, so the hook can be chosen by ear. Plain DOM on purpose (a tool, not
 * game UI).
 */
export function installAudition(game: Game): void {
  const root = document.createElement('div');
  root.id = 'audition';
  root.setAttribute(
    'style',
    'position:fixed;inset:0;z-index:20;overflow:auto;background:rgba(3,9,17,.94);color:#c5e1e8;font:15px/1.5 system-ui,sans-serif;padding:16px;touch-action:auto;-webkit-user-select:text;user-select:text',
  );
  const audio = game.audio;
  const ready = async (): Promise<void> => {
    await audio.unlock();
    if (withMusic.checked) audio.startLoops();
    else audio.stopLoops();
  };

  const heading = document.createElement('h1');
  heading.textContent = 'Neon River: pick the leitmotif';
  heading.setAttribute('style', 'font-size:20px;margin:0 0 4px;color:#8ff8ff');
  const note = document.createElement('p');
  note.setAttribute('style', 'margin:0 0 12px;color:#99c8cd;max-width:60ch');
  note.textContent =
    'Three original motifs in D hirajoshi at 80 BPM. "Catch sequence" plays the 32 notes a perfect streak would play, as steady eighth notes. In the game each note lands on a catch.';
  const label = document.createElement('label');
  label.setAttribute('style', 'display:block;margin:0 0 14px');
  const withMusic = document.createElement('input');
  withMusic.type = 'checkbox';
  withMusic.checked = true;
  withMusic.addEventListener('change', () => void ready());
  label.append(withMusic, ' play over the music loop');
  root.append(heading, note, label);

  const status = document.createElement('p');
  status.setAttribute('style', 'margin:12px 0;color:#ffd98a;font-weight:600');
  const showChoice = (): void => {
    status.textContent = `In use: ${audio.theme.name}. Share this to make it the default: ?theme=${audio.theme.id}`;
  };

  const button = (text: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute(
      'style',
      'min-height:44px;margin:0 8px 8px 0;padding:8px 14px;border:1px solid #29bcc2;border-radius:6px;background:#091a27;color:#c5e1e8;font:inherit;cursor:pointer',
    );
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
      button('Phase stinger', () => audio.playThemeCue(theme, 'phaseSting')),
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
      root.remove();
    }),
    status,
  );
  showChoice();
  document.body.append(root);
}
