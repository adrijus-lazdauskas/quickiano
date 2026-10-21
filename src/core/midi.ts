import { Midi } from "@tonejs/midi";
import { spellMidi } from "./noteNames";
import { finalizeScore, type MeasureDraft } from "./score";
import type { Hand, RawNote, Score } from "./types";

const FIFTHS: Record<string, number> = {
  Cb: -7,
  Gb: -6,
  Db: -5,
  Ab: -4,
  Eb: -3,
  Bb: -2,
  F: -1,
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  "F#": 6,
  "C#": 7,
};

/** Snap to 1/48 of a quarter so slightly humanised files line up. */
const snap = (q: number) => Math.round(q * 48) / 48;

interface Src {
  midi: number;
  q: number;
  dur: number;
}

export const isMidi = (u8: Uint8Array) =>
  u8[0] === 0x4d && u8[1] === 0x54 && u8[2] === 0x68 && u8[3] === 0x64;

/**
 * Reads a Standard MIDI File. Two piano tracks become the two hands (higher one
 * on the right); a single track is split at middle C. Bars come from the time
 * signatures; playback uses the app's own tempo.
 */
export function parseMidi(buf: ArrayBuffer, fileName: string): Score {
  let midi: Midi;
  try {
    midi = new Midi(buf);
  } catch {
    throw new Error("This MIDI file could not be read.");
  }
  const ppq = midi.header.ppq || 480;
  const tracks = midi.tracks
    .filter((t) => t.notes.length && t.channel !== 9)
    .map((t) => ({
      notes: t.notes.map((n): Src => ({
        midi: n.midi,
        q: snap(n.ticks / ppq),
        dur: snap(n.durationTicks / ppq),
      })),
    }))
    .map((t) => ({ ...t, avg: t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length }));
  if (!tracks.length) throw new Error("No notes found in this MIDI file.");

  const hands: Src[][] = [[], []];
  if (tracks.length >= 2) {
    const two = tracks
      .slice()
      .sort((a, b) => b.notes.length - a.notes.length)
      .slice(0, 2)
      .sort((a, b) => b.avg - a.avg);
    hands[0] = two[0].notes;
    hands[1] = two[1].notes;
  } else {
    for (const n of tracks[0].notes) hands[n.midi >= 60 ? 0 : 1].push(n);
  }

  // Bars from the time signature map.
  const sigs = (
    midi.header.timeSignatures.length ? midi.header.timeSignatures : [{ ticks: 0, timeSignature: [4, 4] }]
  )
    .map((s) => ({ q: s.ticks / ppq, beats: s.timeSignature[0], beatType: s.timeSignature[1] }))
    .sort((a, b) => a.q - b.q);
  const lastEnd = Math.max(...hands.flat().map((n) => n.q + Math.max(n.dur, 0.25)));
  const measures: MeasureDraft[] = [];
  const ks = midi.header.keySignatures[0];
  // @tonejs/midi names a signature by its major key, also in minor (A minor is "C"), so this is the count.
  const fifths = ks ? (FIFTHS[ks.key] ?? 0) : 0;
  const mode = ks?.scale === "minor" ? "minor" : "major";
  let q = 0;
  let si = 0;
  while (q < lastEnd - 1e-6 && measures.length < 5000) {
    while (si + 1 < sigs.length && sigs[si + 1].q <= q + 1e-6) si++;
    const s = sigs[si];
    const len = (s.beats * 4) / s.beatType;
    measures.push({
      label: String(measures.length + 1),
      startQ: q,
      durQ: len,
      beats: s.beats,
      beatType: s.beatType,
      pickup: false,
      fifths,
      mode,
      barEnd: "",
      rehearsal: "",
      change:
        measures.length > 0 &&
        (s.beats !== measures.at(-1)!.beats || s.beatType !== measures.at(-1)!.beatType),
      repeatStart: false,
      repeatTimes: 0,
      ending: null,
    });
    q += len;
  }

  const flats = fifths < 0;
  const notes: RawNote[] = [];
  let order = 0;
  hands.forEach((list, hand) => {
    for (const n of list.sort((a, b) => a.q - b.q || a.midi - b.midi)) {
      let m = measures.findIndex((x) => n.q < x.startQ + x.durQ - 1e-6);
      if (m < 0) m = measures.length - 1;
      const sp = spellMidi(n.midi, flats);
      notes.push({
        staff: hand as Hand,
        staffKey: "midi:" + hand,
        voice: "1",
        rel: n.q - measures[m].startQ,
        dur: Math.max(n.dur, 1 / 48),
        midi: n.midi,
        step: sp.step,
        alter: sp.alter,
        octave: sp.octave,
        grace: false,
        chord: false,
        tieStart: false,
        tieStop: false,
        fileFinger: null,
        order: order++,
        m,
        q: n.q,
        shift: 0,
      });
    }
  });

  const title = midi.header.name?.trim() || fileName.replace(/\.(mid|midi)$/i, "");
  return finalizeScore({
    title,
    composer: "",
    source: "midi",
    measures,
    notes,
    staffMap: {},
    usedParts: [],
    staffCount: hands[1].length ? 2 : 1,
    tempo: Math.round(midi.header.tempos[0]?.bpm ?? 0),
  });
}
