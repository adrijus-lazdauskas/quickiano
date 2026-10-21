/** Letter of a written note, MusicXML spelling (B is the German H). */
export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

/** 0 = right hand (upper staff), 1 = left hand (lower staff). */
export type Hand = 0 | 1;

export type FingerSource = "auto" | "file" | "user";

/** Shortest right-hand value in a bar, used to colour the timeline. */
export type MeasureKind = "lh-only" | "calm" | "eighths" | "sixteenths";

export interface Note {
  /** Stable id, used as the key for fingering overrides. */
  id: string;
  staff: Hand;
  /** Source staff, "part:staff", used to apply octave shifts. */
  staffKey: string;
  voice: string;
  /** Index of the measure. */
  m: number;
  /** Onset inside the measure in quarter notes. */
  rel: number;
  /** Absolute onset in quarter notes. */
  q: number;
  /** Written duration in quarter notes, 0 for grace notes. */
  dur: number;
  /** Sounding length including tied continuations. */
  remain: number;
  /** Written pitch as MIDI number: where the note is drawn, 8va lines taken out. */
  midi: number;
  /** Sounding pitch, the key you actually press. MusicXML's <pitch> holds this one. */
  sound: number;
  shift: number;
  step: Step;
  alter: number;
  /** Written octave, like `midi`. */
  octave: number;
  grace: boolean;
  chord: boolean;
  /** 1 sits right before the main note, 2 before that, and so on. */
  graceRank: number;
  tieStart: boolean;
  tieStop: boolean;
  /** Tied continuation: not struck again. */
  cont: boolean;
  /** Neighbours in a tie chain. */
  next: Note | null;
  prev: Note | null;
  fileFinger: number | null;
  fixed: number | null;
  autoFinger: number | null;
  finger: number | null;
  fingerSrc: FingerSource | null;
  order: number;
}

export interface Measure {
  idx: number;
  label: string;
  startQ: number;
  durQ: number;
  nominal: number;
  beats: number;
  beatType: number;
  /** Length of one counted beat in quarter notes. */
  beatQ: number;
  pickup: boolean;
  fifths: number;
  mode: string;
  barEnd: string;
  rehearsal: string;
  change: boolean;
  kind: MeasureKind;
  /** A forward repeat sign at the start of the bar. */
  repeatStart: boolean;
  /** How often the section before a backward repeat at the end of the bar is played, 0 without one. */
  repeatTimes: number;
  /** Volta numbers when the bar is in a 1st, 2nd, … ending. */
  ending: number[] | null;
}

export type Section = [from: number, to: number];

export interface Score {
  title: string;
  composer: string;
  source: "musicxml" | "midi";
  measures: Measure[];
  notes: Note[];
  /** "part:staff" -> hand, only for MusicXML. */
  staffMap: Record<string, Hand>;
  usedParts: number[];
  staffCount: number;
  hasShift: boolean;
  /** Target tempo in quarter notes per minute, 0 if the file has none. */
  tempo: number;
  fifths: number;
  mode: string;
  timeLabel: string;
  sections: Section[];
  /** Lowest and highest sounding pitch. */
  lo: number;
  hi: number;
}

/** Parsed note before ids, ties and fingering are worked out. */
export type RawNote = Pick<
  Note,
  | "staff"
  | "staffKey"
  | "voice"
  | "rel"
  | "dur"
  | "midi"
  | "step"
  | "alter"
  | "octave"
  | "grace"
  | "chord"
  | "tieStart"
  | "tieStop"
  | "fileFinger"
  | "order"
> & { m: number; q: number; shift: number };

export const EPS = 1e-6;
