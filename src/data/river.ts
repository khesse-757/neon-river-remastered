import type { RiverData } from '../sim/river';

/**
 * River fit to the painting (source pixels, 768x1376). Edit with the dev path editor (?debug)
 * and paste its export here.
 */
export const RIVER: RiverData = {
  camera: { focal: 1100, horizonY: 150, centerX: 384, centerY: 688, height: 1 },
  banks: [
    [527, 241, 540, 243],
    [546, 256, 583, 261],
    [550, 285, 617, 290],
    [531, 308, 610, 330],
    [492, 331, 545, 370],
    [431, 346, 505, 400],
    [350, 372, 492, 440],
    [262, 408, 520, 468],
    [210, 455, 545, 495],
    [222, 520, 565, 545],
    [215, 600, 600, 600],
    [123, 700, 695, 700],
    [80, 800, 719, 800],
    [63, 900, 723, 900],
    [53, 985, 716, 985],
    [50, 1050, 700, 1070],
  ],
  railIndex: 14,
  laneMargin: 0.09,
  speedProfile: 0.6,
};
