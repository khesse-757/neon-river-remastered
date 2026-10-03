import type { FishKind } from '../sim/config';

/**
 * Fish sprites as palette-index grids ('.' or '0' = transparent). The near sizes are Neon River
 * v1's sprites, ported by hand and turned to face down-river; the smaller sizes are authored for
 * distance so pixels are swapped, never resampled.
 */
export interface SpriteGrid {
  readonly width: number;
  readonly height: number;
  /** Row-major palette indices, 0 = transparent. */
  readonly cells: Uint8Array;
}

/** v1 palettes (index 1 is the outline). */
export const FISH_COLORS: Readonly<Record<FishKind, readonly string[]>> = {
  // Lifted two steps from v1's blues so a bluegill still reads against the night water.
  bluegill: ['', '#0a0a1a', '#2b597f', '#547ea2', '#729fb4', '#c7e1e8', '#ffffff', '#29bbc2'],
  koi: ['', '#2a1a0a', '#cc6600', '#ff9933', '#ffcc66', '#ffeecc', '#ffffff', '#ffdd88'],
  eel: ['', '#0a0a1a', '#1a1a3a', '#2a2a5a', '#00ffff', '#44ffff', '#ffffff', '#0088aa', '#29bcc2'],
};

function parse(rows: readonly string[]): SpriteGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const cells = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? '.';
      cells[y * width + x] = ch === '.' ? 0 : Number(ch);
    }
  });
  return { width, height, cells };
}

/** v1 sprites face left; turn them a quarter turn so the head points down the screen. */
function faceDown(grid: SpriteGrid): SpriteGrid {
  const width = grid.height;
  const height = grid.width;
  const cells = new Uint8Array(width * height);
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) cells[r * width + c] = grid.cells[c * grid.width + (grid.width - 1 - r)] ?? 0;
  return { width, height, cells };
}

const V1_BLUEGILL = [
  '0000001110000000',
  '0000113331100000',
  '0001332233310000',
  '0013222223331000',
  '0132211222333110',
  '1732216122333551',
  '1773211223335551',
  '1733222233355510',
  '0133322333555100',
  '0013333335551000',
  '0001133355110000',
  '0000011111000000',
];

const V1_KOI = [
  '00000001111000000000',
  '00000113333110000000',
  '00001332223331000000',
  '00013222222333100000',
  '00132211222233310000',
  '01732216122233351100',
  '17732211222333555510',
  '17733222223335555551',
  '17333222233355555510',
  '01333322333555551100',
  '00133333335555510000',
  '00013333355551100000',
  '00001133555110000000',
  '00000011111000000000',
];

const V1_EEL = [
  '000001111000000000000000',
  '000112222111100000000000',
  '001221612233431110000000',
  '012221122335332211111100',
  '012222223343322223332210',
  '001222233533222234322100',
  '000112334322223353211000',
  '000001111111111111100000',
];

const BLUEGILL_MID = [
  '.7.....7.',
  '.77...77.',
  '..77377..',
  '...232...',
  '..23332..',
  '.2333352.',
  '.2333552.',
  '72333552.',
  '.2363552.',
  '..23352..',
  '...232...',
  '....2....',
];
const BLUEGILL_FAR = ['7....7', '.7..7.', '..33..', '.2332.', '233352', '236352', '.2352.', '..22..'];
const BLUEGILL_TINY = ['7.7', '.3.', '333', '353', '.2.'];

const KOI_MID = [
  '..7....7..',
  '..77..77..',
  '...7777...',
  '....33....',
  '...2332...',
  '...2552...',
  '..235532..',
  '..233332..',
  '.72333327.',
  '.72355327.',
  '..235532..',
  '..233332..',
  '..236332..',
  '...2332...',
  '....22....',
];
const KOI_FAR = ['.7...7.', '..7.7..', '...3...', '..232..', '..353..', '.23532.', '.23332.', '.23632.', '..232..', '...2...'];
const KOI_TINY = ['7.7', '.3.', '353', '333', '353', '.2.'];

// Small eels carry a teal electric edge (8) so the dark body still reads on night water.
const EEL_MID = [
  '..8..',
  '..8..',
  '.828.',
  '82328',
  '82428',
  '82328',
  '82328',
  '82528',
  '82328',
  '82328',
  '82428',
  '82328',
  '82328',
  '82528',
  '82328',
  '82328',
  '82628',
  '.888.',
];
const EEL_FAR = ['.8.', '.8.', '838', '848', '838', '838', '858', '838', '848', '838', '868', '.8.'];
const EEL_TINY = ['.8.', '.8.', '.3.', '.4.', '.8.', '.5.', '.3.', '.8.'];

/** Sizes per kind, smallest to largest. */
export const FISH_SPRITES: Readonly<Record<FishKind, readonly SpriteGrid[]>> = {
  bluegill: [parse(BLUEGILL_TINY), parse(BLUEGILL_FAR), parse(BLUEGILL_MID), faceDown(parse(V1_BLUEGILL))],
  koi: [parse(KOI_TINY), parse(KOI_FAR), parse(KOI_MID), faceDown(parse(V1_KOI))],
  eel: [parse(EEL_TINY), parse(EEL_FAR), parse(EEL_MID), faceDown(parse(V1_EEL))],
};

/** Lantern on the bridge parapet. Colors index into LANTERN_COLORS. */
export const LANTERN = parse([
  '..111..',
  '.1...1.',
  '..111..',
  '.13331.',
  '1322231',
  '1324231',
  '1322231',
  '1322231',
  '.13331.',
  '..111..',
]);
export const LANTERN_COLORS: readonly string[] = ['', '#0a0a1a', '#ffd98a', '#ffb347', '#ffffff'];
