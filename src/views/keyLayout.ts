import { isBlack } from "../core/fingering";

export interface KeyGeom {
  midi: number;
  black: boolean;
  /** Left edge and width in CSS pixels. */
  x: number;
  w: number;
}

/** Keyboard range for a song: whole octaves C to C, at least three octaves, inside the 88 keys. */
export function rangeFor(lo: number, hi: number): [number, number] {
  let a = Math.floor(lo / 12) * 12;
  let b = Math.ceil((hi + 1) / 12) * 12;
  while (b - a < 36) {
    if (a > 36) a -= 12;
    else b += 12;
  }
  return [Math.max(21, a), Math.min(108, b)];
}

/** Horizontal geometry of the keys, shared by the keyboard and the falling notes. */
export class KeyLayout {
  readonly keys = new Map<number, KeyGeom>();
  readonly whiteW: number;
  readonly whites: number[] = [];

  constructor(
    readonly lo: number,
    readonly hi: number,
    readonly width: number,
  ) {
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) this.whites.push(m);
    this.whiteW = width / this.whites.length;
    this.whites.forEach((m, i) =>
      this.keys.set(m, { midi: m, black: false, x: i * this.whiteW, w: this.whiteW }),
    );
    const bw = this.whiteW * 0.62;
    for (let m = lo; m <= hi; m++) {
      if (!isBlack(m)) continue;
      const left = this.keys.get(m - 1);
      if (!left) continue;
      // Real black keys sit a little off-centre inside each group.
      const pc = m % 12;
      const nudge = { 1: -0.12, 3: 0.12, 6: -0.15, 8: 0, 10: 0.15 }[pc] ?? 0;
      const cx = left.x + left.w + nudge * bw;
      this.keys.set(m, { midi: m, black: true, x: cx - bw / 2, w: bw });
    }
  }

  get(midi: number): KeyGeom | undefined {
    return this.keys.get(midi);
  }

  center(midi: number): number {
    const k = this.keys.get(midi);
    return k ? k.x + k.w / 2 : -100;
  }

  /** Key under a point; `blackDepth` is the black key height as a fraction of the keyboard. */
  hit(x: number, yFrac: number, blackDepth: number): number | null {
    if (yFrac <= blackDepth) {
      for (const k of this.keys.values()) if (k.black && x >= k.x && x < k.x + k.w) return k.midi;
    }
    const i = Math.floor(x / this.whiteW);
    return this.whites[i] ?? null;
  }
}
