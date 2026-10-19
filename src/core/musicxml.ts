import { finalizeScore, type MeasureDraft, UNTITLED } from "./score";
import type { Hand, RawNote, Score, Step } from "./types";
import { EPS } from "./types";

export const STEP_PC: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const kid = (el: Element, name: string): Element | null => {
  for (const c of el.children) if (c.nodeName === name) return c;
  return null;
};
const kids = (el: Element, name: string): Element[] =>
  Array.from(el.children).filter((c) => c.nodeName === name);
const kidText = (el: Element, name: string): string => kid(el, name)?.textContent?.trim() ?? "";
const kidNum = (el: Element, name: string, fallback: number): number => {
  const v = parseFloat(kidText(el, name));
  return Number.isFinite(v) ? v : fallback;
};

interface ShiftMark {
  staffKey: string;
  pos: number;
  q: number;
  order: number;
  shift: number;
}

interface PartMeasure {
  number: string;
  implicit: boolean;
  notes: RawNote[];
  shifts: ShiftMark[];
  barEnd: string;
  rehearsal: string;
  tempo: number;
  change: boolean;
  len: number;
  beats: number;
  beatType: number;
  fifths: number;
  mode: string;
}

const isStep = (s: string): s is Step => s in STEP_PC;

/** "Composed by", "Music by", "Arr. by", "By" … at the start of a credit line. */
const BYLINE = /^(?:(?:composed|written|music|words|lyrics|arranged|arr\.?|transcribed)\s+(?:by\s+)?|by\s+)/i;

function parsePart(partEl: Element, pi: number, staffMap: Record<string, Hand>): PartMeasure[] {
  let divisions = 1;
  let beats = 4;
  let beatType = 4;
  let fifths = 0;
  let mode = "major";
  let order = 0;
  const out: PartMeasure[] = [];
  for (const me of kids(partEl, "measure")) {
    let pos = 0;
    let maxPos = 0;
    let lastOnset = 0;
    const rec: PartMeasure = {
      number: me.getAttribute("number") || "",
      implicit: me.getAttribute("implicit") === "yes",
      notes: [],
      shifts: [],
      barEnd: "",
      rehearsal: "",
      tempo: 0,
      change: false,
      len: 0,
      beats,
      beatType,
      fifths,
      mode,
    };
    for (const el of me.children) {
      switch (el.nodeName) {
        case "attributes": {
          divisions = kidNum(el, "divisions", divisions) || divisions;
          const ti = kid(el, "time");
          if (ti && kid(ti, "beats")) {
            const b = kidText(ti, "beats")
              .split("+")
              .reduce((s, x) => s + (parseInt(x, 10) || 0), 0);
            const bt = parseInt(kidText(ti, "beat-type"), 10);
            if (b && bt) {
              if (out.length && (b !== beats || bt !== beatType)) rec.change = true;
              beats = b;
              beatType = bt;
            }
          }
          const ke = kid(el, "key");
          if (ke && kid(ke, "fifths")) {
            const fi = parseInt(kidText(ke, "fifths"), 10) || 0;
            if (out.length && fi !== fifths) rec.change = true;
            fifths = fi;
            mode = kidText(ke, "mode") || "major";
          }
          break;
        }
        case "backup":
          pos = Math.max(0, pos - kidNum(el, "duration", 0) / divisions);
          break;
        case "forward":
          pos += kidNum(el, "duration", 0) / divisions;
          maxPos = Math.max(maxPos, pos);
          break;
        case "direction": {
          const off = kidNum(el, "offset", 0) / divisions;
          const staff = parseInt(kidText(el, "staff"), 10) || 1;
          for (const dt of kids(el, "direction-type")) {
            for (const os of kids(dt, "octave-shift")) {
              const type = os.getAttribute("type");
              const size = parseInt(os.getAttribute("size") || "", 10) || 8;
              const oct = Math.max(1, Math.round((size - 1) / 7));
              const shift = type === "down" ? 12 * oct : type === "up" ? -12 * oct : 0;
              rec.shifts.push({ staffKey: pi + ":" + staff, pos: pos + off, q: 0, order: order++, shift });
            }
            const reh = kid(dt, "rehearsal");
            if (reh && !rec.rehearsal) rec.rehearsal = reh.textContent?.trim() ?? "";
            const met = kid(dt, "metronome");
            if (met && !rec.tempo && kid(met, "per-minute")) {
              const unit = kidText(met, "beat-unit");
              const factor =
                ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 } as Record<string, number>)[
                  unit
                ] || 1;
              rec.tempo =
                (parseFloat(kidText(met, "per-minute")) || 0) *
                factor *
                (kid(met, "beat-unit-dot") ? 1.5 : 1);
            }
          }
          const snd = kid(el, "sound");
          if (snd?.getAttribute("tempo") && !rec.tempo)
            rec.tempo = parseFloat(snd.getAttribute("tempo")!) || 0;
          break;
        }
        case "sound":
          if (el.getAttribute("tempo") && !rec.tempo) rec.tempo = parseFloat(el.getAttribute("tempo")!) || 0;
          break;
        case "barline":
          if ((el.getAttribute("location") || "right") === "right") rec.barEnd = kidText(el, "bar-style");
          break;
        case "note": {
          const grace = !!kid(el, "grace");
          const chord = !!kid(el, "chord");
          const rest = !!kid(el, "rest");
          const cue = !!kid(el, "cue");
          const dur = grace ? 0 : kidNum(el, "duration", 0) / divisions;
          let onset: number;
          if (chord) onset = lastOnset;
          else {
            onset = pos;
            lastOnset = pos;
          }
          const staff = parseInt(kidText(el, "staff"), 10) || 1;
          const hand = staffMap[pi + ":" + staff];
          const p = kid(el, "pitch");
          if (!rest && !cue && p && hand != null) {
            const step = kidText(p, "step");
            const alter = Math.round(kidNum(p, "alter", 0));
            const octave = parseInt(kidText(p, "octave"), 10);
            if (isStep(step) && Number.isFinite(octave)) {
              let tieStart = false;
              let tieStop = false;
              let fing: number | null = null;
              for (const t of kids(el, "tie")) {
                const ty = t.getAttribute("type");
                if (ty === "start") tieStart = true;
                else if (ty === "stop") tieStop = true;
              }
              for (const nt of kids(el, "notations")) {
                for (const t of kids(nt, "tied")) {
                  const ty = t.getAttribute("type");
                  if (ty === "start") tieStart = true;
                  else if (ty === "stop") tieStop = true;
                }
                for (const tech of kids(nt, "technical")) {
                  const fe = kid(tech, "fingering");
                  if (fe && fing == null) {
                    const v = parseInt(fe.textContent || "", 10);
                    if (v >= 1 && v <= 5) fing = v;
                  }
                }
              }
              rec.notes.push({
                staff: hand,
                staffKey: pi + ":" + staff,
                voice: kidText(el, "voice") || "1",
                rel: onset,
                dur,
                midi: (octave + 1) * 12 + STEP_PC[step] + alter,
                step,
                alter,
                octave,
                grace,
                chord,
                tieStart,
                tieStop,
                fileFinger: fing,
                order: order++,
                m: 0,
                q: 0,
                shift: 0,
              });
            }
          }
          if (!chord && !grace) pos += dur;
          maxPos = Math.max(maxPos, pos);
          break;
        }
      }
    }
    Object.assign(rec, { len: maxPos, beats, beatType, fifths, mode });
    out.push(rec);
  }
  return out;
}

/** Parses partwise MusicXML. Throws an Error with a readable message on bad input. */
export function parseMusicXML(text: string): Score {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("This file is not valid MusicXML.");
  const root = doc.documentElement;
  if (root.nodeName === "score-timewise") {
    throw new Error("This file uses the rare 'timewise' MusicXML layout. Export it as regular MusicXML.");
  }
  if (root.nodeName !== "score-partwise") throw new Error("This is not a MusicXML score.");

  const work = kid(root, "work");
  const credits = Array.from(root.getElementsByTagName("credit"))
    .filter((c) => (c.getAttribute("page") || "1") === "1")
    .flatMap((c) => Array.from(c.getElementsByTagName("credit-words")))
    .map((c) => ({
      text: c.textContent?.replace(/\s+/g, " ").trim() ?? "",
      size: parseFloat(c.getAttribute("font-size") || "") || 0,
      just: c.getAttribute("justify") || c.getAttribute("halign") || "",
    }))
    .filter((c) => c.text.length > 1 && !/^\d+$/.test(c.text));
  // Recognised scores (Audiveris) sometimes call the "Composed by …" line the title.
  const usable = (t: string) => (t && !BYLINE.test(t) ? t : "");
  let title =
    usable((work && kidText(work, "work-title")) || "") ||
    usable(kidText(root, "movement-title")) ||
    credits.filter((c) => usable(c.text)).sort((a, b) => b.size - a.size)[0]?.text ||
    "";
  let composer = "";
  const ident = kid(root, "identification");
  if (ident) {
    for (const c of kids(ident, "creator")) {
      if (c.getAttribute("type") === "composer") composer = c.textContent?.trim() ?? "";
    }
  }
  if (!composer) {
    composer =
      credits.find((c) => BYLINE.test(c.text))?.text ?? credits.find((c) => c.just === "right")?.text ?? "";
  }
  composer = composer.replace(BYLINE, "").trim();
  title = title.replace(/\s+/g, " ").trim();

  const partEls = kids(root, "part");
  if (!partEls.length) throw new Error("This file has no parts.");
  const partStaves = partEls.map((p) => {
    let n = 1;
    for (const s of p.getElementsByTagName("staves")) n = Math.max(n, parseInt(s.textContent || "", 10) || 1);
    return n;
  });
  // Hands: a two-staff piano part wins; otherwise the first two parts.
  let use: { pi: number; ls: number }[];
  const piano = partStaves.findIndex((n) => n >= 2);
  if (piano >= 0)
    use = [
      { pi: piano, ls: 1 },
      { pi: piano, ls: 2 },
    ];
  else if (partEls.length >= 2)
    use = [
      { pi: 0, ls: 1 },
      { pi: 1, ls: 1 },
    ];
  else use = [{ pi: 0, ls: 1 }];
  const staffMap: Record<string, Hand> = {};
  use.forEach((u, g) => {
    staffMap[u.pi + ":" + u.ls] = g as Hand;
  });
  const usedParts = [...new Set(use.map((u) => u.pi))];
  const perPart = usedParts.map((pi) => parsePart(partEls[pi], pi, staffMap));

  const measures: MeasureDraft[] = [];
  const notes: RawNote[] = [];
  const shifts: ShiftMark[] = [];
  const count = Math.max(...perPart.map((p) => p.length));
  let q = 0;
  let tempo = 0;
  for (let i = 0; i < count; i++) {
    const recs = perPart.map((p) => p[i]).filter(Boolean);
    const r0 = recs[0];
    const nominal = (r0.beats * 4) / r0.beatType;
    let len = Math.max(...recs.map((r) => r.len));
    if (len < EPS) len = nominal;
    measures.push({
      label: r0.number || String(i + 1),
      startQ: q,
      durQ: len,
      beats: r0.beats,
      beatType: r0.beatType,
      pickup: len < nominal - EPS && (r0.implicit || i === 0),
      fifths: r0.fifths,
      mode: r0.mode,
      barEnd: r0.barEnd,
      rehearsal: r0.rehearsal,
      change: r0.change,
    });
    for (const r of recs) {
      if (!tempo && r.tempo) tempo = r.tempo;
      for (const n of r.notes) {
        n.m = i;
        n.q = q + n.rel;
        notes.push(n);
      }
      for (const s of r.shifts) {
        s.q = q + s.pos;
        shifts.push(s);
      }
    }
    q += len;
  }

  // Octave shifts: the latest shift on the same staff before the note applies.
  shifts.sort((a, b) => a.q - b.q || a.order - b.order);
  for (const n of notes) {
    let shift = 0;
    for (const s of shifts) {
      if (s.staffKey !== n.staffKey) continue;
      if (s.q < n.q - EPS || (Math.abs(s.q - n.q) < EPS && s.order < n.order)) shift = s.shift;
    }
    n.shift = shift;
  }

  return finalizeScore({
    title: title || UNTITLED,
    composer,
    source: "musicxml",
    measures,
    notes,
    staffMap,
    usedParts,
    staffCount: use.length,
    tempo: Math.round(tempo) || 0,
  });
}
