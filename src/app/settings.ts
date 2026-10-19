import type { Naming } from "../core/noteNames";

export type ViewMode = "falling" | "sheet";

export interface Settings {
  view: ViewMode;
  naming: Naming;
  palette: string;
  rightColor: string;
  leftColor: string;
  effects: boolean;
  noteNames: boolean;
  fingering: boolean;
  loop: boolean;
  countIn: boolean;
  hearRight: boolean;
  hearLeft: boolean;
  click: boolean;
  bpm: number;
}

export interface Palette {
  id: string;
  name: string;
  right: string;
  left: string;
}

export const PALETTES: Palette[] = [
  { id: "neon", name: "Neon", right: "#ff4fd8", left: "#8b5cff" },
  { id: "ocean", name: "Ocean", right: "#22d3ee", left: "#3b82f6" },
  { id: "classic", name: "Classic", right: "#4ade80", left: "#38bdf8" },
  { id: "sunset", name: "Sunset", right: "#fb923c", left: "#f43f5e" },
  { id: "gold", name: "Gold", right: "#facc15", left: "#a3e635" },
];

const reducedMotion =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const DEFAULTS: Settings = {
  view: "falling",
  naming: "english",
  palette: "neon",
  rightColor: PALETTES[0].right,
  leftColor: PALETTES[0].left,
  effects: !reducedMotion,
  noteNames: false,
  fingering: true,
  loop: true,
  countIn: true,
  hearRight: true,
  hearLeft: true,
  click: true,
  bpm: 60,
};

const KEY = "quickiano:settings";

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

type Listener = (s: Settings, changed: (keyof Settings)[]) => void;

/** Typed settings with persistence; views subscribe and redraw what changed. */
export class SettingsStore {
  private state: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    const saved = lsGet<Partial<Settings>>(KEY, {});
    this.state = { ...DEFAULTS, ...sanitize(saved) };
  }

  get(): Readonly<Settings> {
    return this.state;
  }

  set(patch: Partial<Settings>): void {
    const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== this.state[k]);
    if (!changed.length) return;
    this.state = { ...this.state, ...patch };
    lsSet(KEY, this.state);
    this.listeners.forEach((fn) => fn(this.state, changed));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function sanitize(s: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (k in s && typeof s[k] === typeof DEFAULTS[k]) (out as Record<string, unknown>)[k] = s[k];
  }
  if (out.view && out.view !== "falling" && out.view !== "sheet") delete out.view;
  if (out.naming && !["english", "german", "solfege"].includes(out.naming)) delete out.naming;
  if (out.bpm != null && !(out.bpm >= 20 && out.bpm <= 240)) delete out.bpm;
  return out;
}
