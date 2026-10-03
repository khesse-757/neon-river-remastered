import { createCamera, type CameraSpec, type PaintingCamera, type Projected } from './camera';

/**
 * The river as the sim sees it: two bank splines on the water plane, fitted to the painting.
 * `s` is normalised arc length along the centreline (0 = far bend, 1 = net rail, >1 = under the
 * bridge). `lane` runs 0 (left bank at the rail) to 1 (right bank) across the usable width.
 */
export interface RiverData {
  readonly camera: CameraSpec;
  /** Bank pairs in painting pixels, far to near: [leftX, leftY, rightX, rightY]. */
  readonly banks: readonly (readonly [number, number, number, number])[];
  /** Index of the bank pair that is the net rail. */
  readonly railIndex: number;
  /** Fraction of the width kept clear at each bank. */
  readonly laneMargin: number;
  /** 0 = fish move at constant world speed, 1 = constant speed on screen. */
  readonly speedProfile: number;
}

interface Vec2 {
  x: number;
  z: number;
}

const SAMPLES_PER_SEGMENT = 24;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

export class River {
  readonly camera: PaintingCamera;
  /** World width between the lane-0 and lane-1 lines at the rail. */
  readonly railWidth: number;
  /** World length of the centreline from the far bend to the rail. */
  readonly length: number;
  /** Largest valid s (the end of the spline, under the bridge). */
  readonly maxS: number;

  private readonly left: Vec2[];
  private readonly right: Vec2[];
  /** Spline parameter at each LUT sample, and normalised arc length there. */
  private readonly lutT: number[] = [];
  private readonly lutS: number[] = [];
  /** u -> s lookup for the speed profile. */
  private readonly progressLut: number[] = [];
  private readonly progressTailSlope: number;

  constructor(readonly data: RiverData) {
    this.camera = createCamera(data.camera);
    this.left = data.banks.map(([lx, ly]) => this.camera.unproject(lx, ly));
    this.right = data.banks.map(([, , rx, ry]) => this.camera.unproject(rx, ry));

    const segments = data.banks.length - 1;
    const total = segments * SAMPLES_PER_SEGMENT;
    let acc = 0;
    let prev = this.centerAtT(0);
    let railAcc = 0;
    const raw: number[] = [];
    for (let i = 0; i <= total; i++) {
      const t = i / SAMPLES_PER_SEGMENT;
      const p = this.centerAtT(t);
      acc += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
      this.lutT.push(t);
      raw.push(acc);
      if (i === data.railIndex * SAMPLES_PER_SEGMENT) railAcc = acc;
    }
    this.length = railAcc;
    for (const d of raw) this.lutS.push(d / railAcc);
    this.maxS = this.lutS[this.lutS.length - 1] ?? 1;

    const a = this.pointAt(1, 0);
    const b = this.pointAt(1, 1);
    this.railWidth = Math.hypot(b.x - a.x, b.z - a.z);

    // Speed profile: blend world arc length with on-screen arc length, so fish do not spend
    // most of their trip as specks at the far bend.
    const N = 256;
    const screenAcc: number[] = [0];
    let last = this.screenAt(0, 0.5);
    for (let i = 1; i <= N; i++) {
      const p = this.screenAt(i / N, 0.5);
      screenAcc.push((screenAcc[i - 1] ?? 0) + Math.hypot(p.x - last.x, p.y - last.y));
      last = p;
    }
    const screenTotal = screenAcc[N] ?? 1;
    const k = data.speedProfile;
    const g = screenAcc.map((d, i) => (1 - k) * (i / N) + k * (d / screenTotal));
    let j = 0;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      while (j < N - 1 && (g[j + 1] ?? 1) < u) j++;
      const g0 = g[j] ?? 0;
      const g1 = g[j + 1] ?? 1;
      const f = g1 > g0 ? (u - g0) / (g1 - g0) : 0;
      this.progressLut.push((j + Math.min(1, Math.max(0, f))) / N);
    }
    this.progressTailSlope = ((this.progressLut[N] ?? 1) - (this.progressLut[N - 1] ?? 1)) * N;
  }

  /** Fish progress (0 at spawn, 1 at the rail, linear in time) to arc length s. */
  progressToS(u: number): number {
    if (u >= 1) return Math.min(this.maxS, 1 + (u - 1) * this.progressTailSlope);
    const N = this.progressLut.length - 1;
    const x = Math.max(0, u) * N;
    const i = Math.floor(x);
    const a = this.progressLut[i] ?? 0;
    const b = this.progressLut[Math.min(N, i + 1)] ?? a;
    return a + (b - a) * (x - i);
  }

  /** World position on the water plane. */
  pointAt(s: number, lane: number): Vec2 {
    const t = this.sToT(s);
    const m = this.data.laneMargin;
    const f = m + Math.min(1, Math.max(0, lane)) * (1 - 2 * m);
    const l = this.bankAtT(this.left, t);
    const r = this.bankAtT(this.right, t);
    return { x: l.x + (r.x - l.x) * f, z: l.z + (r.z - l.z) * f };
  }

  /** Painting-pixel position and scale of a point on the river. */
  screenAt(s: number, lane: number): Projected {
    const p = this.pointAt(s, lane);
    return this.camera.project(p.x, p.z);
  }

  /** Downstream direction on screen at s (unit vector, painting pixels). */
  screenTangent(s: number, lane: number): { x: number; y: number } {
    const a = this.screenAt(Math.max(0, s - 0.01), lane);
    const b = this.screenAt(Math.min(this.maxS, s + 0.01), lane);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  }

  private sToT(s: number): number {
    const lut = this.lutS;
    const clamped = Math.min(this.maxS, Math.max(0, s));
    let lo = 0;
    let hi = lut.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((lut[mid] ?? 0) <= clamped) lo = mid;
      else hi = mid;
    }
    const s0 = lut[lo] ?? 0;
    const s1 = lut[hi] ?? s0;
    const f = s1 > s0 ? (clamped - s0) / (s1 - s0) : 0;
    const t0 = this.lutT[lo] ?? 0;
    const t1 = this.lutT[hi] ?? t0;
    return t0 + (t1 - t0) * f;
  }

  private centerAtT(t: number): Vec2 {
    const l = this.bankAtT(this.left, t);
    const r = this.bankAtT(this.right, t);
    return { x: (l.x + r.x) / 2, z: (l.z + r.z) / 2 };
  }

  private bankAtT(points: Vec2[], t: number): Vec2 {
    const n = points.length;
    const i = Math.min(n - 2, Math.max(0, Math.floor(t)));
    const f = Math.min(1, Math.max(0, t - i));
    const at = (k: number): Vec2 => points[Math.min(n - 1, Math.max(0, k))] as Vec2;
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    return { x: catmullRom(p0.x, p1.x, p2.x, p3.x, f), z: catmullRom(p0.z, p1.z, p2.z, p3.z, f) };
  }
}
