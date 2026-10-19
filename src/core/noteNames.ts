import { pitchClass } from "./fingering";
import type { Note, Step } from "./types";

/** english: C D E F G A B · german: C D E F G A H (cis, es, b) · solfege: Do Re Mi Fa Sol La Si */
export type Naming = "english" | "german" | "solfege";

export interface Spelling {
  step: Step;
  alter: number;
  octave: number;
}

const SHARP_SPELL: [Step, number][] = [
  ["C", 0],
  ["C", 1],
  ["D", 0],
  ["D", 1],
  ["E", 0],
  ["F", 0],
  ["F", 1],
  ["G", 0],
  ["G", 1],
  ["A", 0],
  ["A", 1],
  ["B", 0],
];
const FLAT_SPELL: [Step, number][] = [
  ["C", 0],
  ["D", -1],
  ["D", 0],
  ["E", -1],
  ["E", 0],
  ["F", 0],
  ["G", -1],
  ["G", 0],
  ["A", -1],
  ["A", 0],
  ["B", -1],
  ["B", 0],
];

/** Spells a key as a note name; flat keys (negative fifths) prefer flats. */
export function spellMidi(midi: number, preferFlats: boolean): Spelling {
  const [step, alter] = (preferFlats ? FLAT_SPELL : SHARP_SPELL)[pitchClass(midi)];
  // B♯ and C♭ never come out of the tables, so the octave is simply the MIDI octave.
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

const SOLFEGE: Record<Step, string> = { C: "Do", D: "Re", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };
const GERMAN: Record<Step, string> = { C: "c", D: "d", E: "e", F: "f", G: "g", A: "a", B: "h" };
const SUP = ["¹", "²", "³", "⁴", "⁵"];
const SUB = ["₁", "₂", "₃"];

function accidental(alter: number): string {
  if (alter > 0) return "♯".repeat(alter);
  if (alter < 0) return "♭".repeat(-alter);
  return "";
}

/** German base name in lower case: c, cis, es, as, b, h, fes … */
function germanLower(step: Step, alter: number): string {
  const s = GERMAN[step];
  if (!alter) return s;
  if (alter > 0) return s + "is".repeat(alter);
  const flat = ({ B: "b", E: "es", A: "as" } as Partial<Record<Step, string>>)[step] ?? s + "es";
  return alter === -1 ? flat : flat + "es".repeat(-alter - 1);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Name without octave: "C♯" · "Cis" · "Do♯". */
export function pitchName(step: Step, alter: number, naming: Naming): string {
  if (naming === "german") return cap(germanLower(step, alter));
  if (naming === "solfege") return SOLFEGE[step] + accidental(alter);
  return step + accidental(alter);
}

/** Name with octave: "C♯4" · "cis¹" (Helmholtz) · "Do♯4". Middle C is C4 / c¹. */
export function fullName(sp: Spelling, naming: Naming): string {
  if (naming !== "german") return pitchName(sp.step, sp.alter, naming) + sp.octave;
  let b = germanLower(sp.step, sp.alter);
  if (sp.octave >= 4) return b + (SUP[sp.octave - 4] ?? "");
  if (sp.octave === 3) return b;
  b = cap(b);
  if (sp.octave === 2) return b;
  return b + (SUB[1 - sp.octave] ?? "");
}

/** Spelling of the key you actually press (8va lines moved into the octave). */
export function soundingSpelling(n: Note): Spelling {
  return { step: n.step, alter: n.alter, octave: n.octave + Math.round(n.shift / 12) };
}

const MAJOR: string[] = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const MINOR: string[] = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"];

/** "A minor", "E♭ major" (english), "Es major" (german), "Mi♭ major" (solfege). */
export function keyName(fifths: number, mode: string, naming: Naming): string {
  const i = Math.max(0, Math.min(14, fifths + 7));
  const minor = mode === "minor";
  const raw = (minor ? MINOR : MAJOR)[i];
  const step = raw[0] as Step;
  const alter = raw[1] === "#" ? 1 : raw[1] === "b" ? -1 : 0;
  return pitchName(step, alter, naming) + (minor ? " minor" : " major");
}
