import type { FishKind } from '../sim/config';

/** What a player has done in one game mode. */
export interface ModeRecord {
  wins: number;
  /** Fastest winning night in seconds, or null before the first win. */
  bestTime: number | null;
  bestStreak: number;
}

export interface Records {
  modes: Record<string, ModeRecord>;
  /** Lifetime fish netted per species; for the eel, the number of times one was netted. */
  catches: Record<FishKind, number>;
  /** Storm Night is open: a Normal win, or the code. */
  hardUnlocked: boolean;
}

const STORE = 'neonriver2_records_v1';
/** Gate 1.5 saved only this flag, set by a Normal win. */
const OLD_UNLOCK = 'neonriver2_hard_river';

export const emptyRecords = (): Records => ({ modes: {}, catches: { bluegill: 0, koi: 0, eel: 0 }, hardUnlocked: false });

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

/** Saved records are untrusted: anything missing or malformed falls back to nothing. */
export function sanitizeRecords(raw: unknown): Records {
  const out = emptyRecords();
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  const modes = (typeof r.modes === 'object' && r.modes !== null ? r.modes : {}) as Record<string, unknown>;
  for (const [id, value] of Object.entries(modes).slice(0, 16)) {
    if (typeof value !== 'object' || value === null) continue;
    const m = value as Record<string, unknown>;
    const time = typeof m.bestTime === 'number' && Number.isFinite(m.bestTime) && m.bestTime > 0 ? m.bestTime : null;
    out.modes[id] = { wins: count(m.wins), bestTime: time, bestStreak: count(m.bestStreak) };
  }
  const catches = (typeof r.catches === 'object' && r.catches !== null ? r.catches : {}) as Record<string, unknown>;
  for (const kind of ['bluegill', 'koi', 'eel'] as const) out.catches[kind] = count(catches[kind]);
  out.hardUnlocked = r.hardUnlocked === true;
  return out;
}

export const modeRecord = (records: Records, id: string): ModeRecord => records.modes[id] ?? { wins: 0, bestTime: null, bestStreak: 0 };

/** Fold one finished night into the records. A loss still counts its best streak. */
export function recordNight(records: Records, id: string, night: { won: boolean; time: number; bestStreak: number }): void {
  const m = { ...modeRecord(records, id) };
  m.bestStreak = Math.max(m.bestStreak, night.bestStreak);
  if (night.won) {
    m.wins += 1;
    m.bestTime = m.bestTime === null ? night.time : Math.min(m.bestTime, night.time);
  }
  records.modes[id] = m;
}

export function loadRecords(): Records {
  try {
    const records = sanitizeRecords(JSON.parse(localStorage.getItem(STORE) ?? 'null'));
    if (localStorage.getItem(OLD_UNLOCK) === '1') records.hardUnlocked = true;
    return records;
  } catch {
    return emptyRecords();
  }
}

export function saveRecords(records: Records): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(records));
  } catch {
    /* storage unavailable */
  }
}

export const formatTime = (seconds: number): string => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
