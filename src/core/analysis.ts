import type { Measure, Note, Section } from "./types";

/** Colours each bar by the shortest right-hand value in it. */
export function classifyMeasures(measures: Measure[], notes: Note[]): void {
  const minDur = measures.map(() => Infinity);
  for (const n of notes) if (n.staff === 0 && !n.grace) minDur[n.m] = Math.min(minDur[n.m], n.dur);
  measures.forEach((m, i) => {
    const d = minDur[i];
    m.kind = d === Infinity ? "lh-only" : d <= 0.26 ? "sixteenths" : d <= 0.51 ? "eighths" : "calm";
  });
}

/**
 * Splits the piece into practice chunks: at rehearsal marks, key/time changes and
 * double bar lines, then long stretches into 8-bar parts.
 */
export function computeSections(M: Measure[]): Section[] {
  const secs: Section[] = [];
  let s = 0;
  for (let i = 0; i < M.length; i++) {
    if (i > s && (M[i].rehearsal || M[i].change)) {
      secs.push([s, i - 1]);
      s = i;
    }
    if (/^(light-light|light-heavy|heavy-light|heavy-heavy)$/.test(M[i].barEnd) && i < M.length - 1) {
      secs.push([s, i]);
      s = i + 1;
    }
  }
  if (s <= M.length - 1) secs.push([s, M.length - 1]);
  const merged: Section[] = [];
  for (const sec of secs) {
    const prev = merged[merged.length - 1];
    if (prev && prev[1] - prev[0] < 1) prev[1] = sec[1];
    else merged.push([sec[0], sec[1]]);
  }
  const out: Section[] = [];
  for (const [a, b] of merged) {
    if (b - a + 1 <= 12) {
      out.push([a, b]);
      continue;
    }
    let x = a;
    if (M[a].pickup) {
      out.push([a, Math.min(b, a + 8)]);
      x = a + 9;
    }
    for (; x <= b; x += 8) {
      const end = Math.min(b, x + 7);
      if (end - x < 2 && out.length) out[out.length - 1][1] = end;
      else out.push([x, end]);
    }
  }
  return out;
}
