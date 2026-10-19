import { classifyMeasures, computeSections } from "./analysis";
import type { Hand, Measure, Note, RawNote, Score } from "./types";
import { EPS } from "./types";

export type MeasureDraft = Pick<
  Measure,
  | "label"
  | "startQ"
  | "durQ"
  | "beats"
  | "beatType"
  | "pickup"
  | "fifths"
  | "mode"
  | "barEnd"
  | "rehearsal"
  | "change"
>;

export interface ScoreDraft {
  title: string;
  composer: string;
  source: Score["source"];
  measures: MeasureDraft[];
  notes: RawNote[];
  staffMap: Record<string, Hand>;
  usedParts: number[];
  staffCount: number;
  tempo: number;
}

/**
 * Shared second pass for every importer: measures get their beat grid, notes get
 * stable ids, tie chains and grace ranks, and the score gets sections and range.
 */
export function finalizeScore(d: ScoreDraft): Score {
  const measures: Measure[] = d.measures.map((m, idx) => {
    const nominal = (m.beats * 4) / m.beatType;
    const compound = m.beatType === 8 && m.beats % 3 === 0 && m.beats > 3;
    return { ...m, idx, nominal, beatQ: compound ? 1.5 : 4 / m.beatType, kind: "calm" };
  });

  const notes: Note[] = d.notes.map((r) => ({
    ...r,
    id: "",
    sound: r.midi + r.shift,
    remain: r.dur,
    graceRank: 0,
    cont: false,
    next: null,
    headM: r.m,
    fixed: null,
    autoFinger: null,
    finger: null,
    fingerSrc: null,
  }));
  notes.sort((a, b) => a.q - b.q || a.order - b.order);

  // Stable ids (used for fingering overrides).
  const seen = new Map<string, number>();
  for (const n of notes) {
    let id =
      n.m +
      ":" +
      n.staff +
      ":" +
      Math.round(n.rel * 960) +
      ":" +
      n.midi +
      ":" +
      n.voice +
      (n.grace ? "g" : "");
    const k = seen.get(id);
    if (k) {
      seen.set(id, k + 1);
      id += "#" + k;
    } else seen.set(id, 1);
    n.id = id;
  }

  // Ties: continuation notes are not struck again; heads carry the full length.
  const tkey = (st: number, midi: number, at: number) => st + "|" + midi + "|" + Math.round(at * 960);
  const stops = new Map<string, Note>();
  for (const n of notes) {
    if (n.tieStop && !n.grace) {
      const k = tkey(n.staff, n.midi, n.q);
      if (!stops.has(k)) stops.set(k, n);
    }
  }
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.remain = n.dur;
    if (n.tieStart && !n.grace) {
      const c = stops.get(tkey(n.staff, n.midi, n.q + n.dur));
      if (c && c !== n && !c.cont) {
        c.cont = true;
        n.next = c;
        n.remain = n.dur + c.remain;
      }
    }
  }
  for (const n of notes) {
    if (n.cont) continue;
    n.headM = n.m;
    for (let c = n.next; c; c = c.next) c.headM = n.m;
  }

  // Grace notes: rank 1 sits right before the main note.
  const graces = new Map<string, Note[]>();
  for (const n of notes) {
    if (!n.grace) continue;
    const k = n.staff + "|" + Math.round(n.q * 960);
    const arr = graces.get(k) ?? [];
    arr.push(n);
    graces.set(k, arr);
  }
  for (const arr of graces.values()) {
    const attacks: Note[][] = [];
    arr
      .sort((a, b) => a.order - b.order)
      .forEach((n) => {
        if (!n.chord || !attacks.length) attacks.push([n]);
        else attacks[attacks.length - 1].push(n);
      });
    attacks.forEach((group, i) =>
      group.forEach((n) => {
        n.graceRank = attacks.length - i;
      }),
    );
  }

  classifyMeasures(measures, notes);

  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) {
    lo = Math.min(lo, n.sound);
    hi = Math.max(hi, n.sound);
  }
  const first = measures.find((m) => !m.pickup) ?? measures[0];
  return {
    title: d.title,
    composer: d.composer,
    source: d.source,
    measures,
    notes,
    staffMap: d.staffMap,
    usedParts: d.usedParts,
    staffCount: d.staffCount,
    hasShift: notes.some((n) => n.shift !== 0),
    tempo: d.tempo,
    fifths: measures[0]?.fifths ?? 0,
    mode: measures[0]?.mode ?? "major",
    timeLabel: first ? first.beats + "/" + first.beatType : "4/4",
    sections: computeSections(measures),
    lo: Number.isFinite(lo) ? lo : 60,
    hi: Number.isFinite(hi) ? hi : 72,
  };
}

/** Notes that start a key press: no tied continuations. */
export function attacks(score: Score): Note[] {
  return score.notes.filter((n) => !n.cont);
}

/** End of the measure range in quarter notes. */
export function rangeQ(score: Score, from: number, to: number): { startQ: number; endQ: number } {
  const a = score.measures[from];
  const b = score.measures[to];
  return { startQ: a.startQ, endQ: b.startQ + b.durQ };
}

export const isWithin = (q: number, a: number, b: number) => q >= a - EPS && q < b - EPS;
