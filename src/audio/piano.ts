import { getContext, output } from "./engine";

/*
 * Piano voice: Salamander Grand Piano samples every minor third, the nearest one
 * pitched by playbackRate. Until they are decoded a small additive synth plays.
 */

const NAMES = ["A0"];
for (let o = 1; o <= 7; o++) NAMES.push("C" + o, "Ds" + o, "Fs" + o, "A" + o);
NAMES.push("C8");

const PC: Record<string, number> = { C: 0, Ds: 3, Fs: 6, A: 9 };
const midiOf = (name: string) => {
  const m = name.match(/^([A-Z]s?)(\d)$/)!;
  return (+m[2] + 1) * 12 + PC[m[1]];
};

const buffers = new Map<number, AudioBuffer>();
let loading: Promise<void> | null = null;

export type PianoState = "loading" | "ready" | "synth";
let state: PianoState = "loading";
const listeners = new Set<(s: PianoState) => void>();

export function pianoState(): PianoState {
  return state;
}

export function onPianoState(fn: (s: PianoState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setState(s: PianoState) {
  state = s;
  listeners.forEach((fn) => fn(s));
}

/** Fetches and decodes all samples once. Safe to call repeatedly. */
export function loadPiano(baseUrl: string): Promise<void> {
  if (loading) return loading;
  const c = getContext();
  if (!c) {
    setState("synth");
    return Promise.resolve();
  }
  loading = Promise.all(
    NAMES.map(async (name) => {
      const res = await fetch(baseUrl + name + ".mp3");
      if (!res.ok) throw new Error("sample " + name + " " + res.status);
      const buf = await c.decodeAudioData(await res.arrayBuffer());
      buffers.set(midiOf(name), buf);
    }),
  ).then(
    () => setState("ready"),
    (e) => {
      console.warn("Piano samples unavailable, using the synth.", e);
      setState("synth");
    },
  );
  return loading;
}

function nearestSample(midi: number): [number, AudioBuffer] | null {
  let best: [number, AudioBuffer] | null = null;
  for (const [m, b] of buffers) if (!best || Math.abs(m - midi) < Math.abs(best[0] - midi)) best = [m, b];
  return best;
}

/**
 * Plays `midi` at audio time `when` for `dur` seconds. `vol` is 0..1.
 * Falls back to the synth while samples load.
 */
export function playNote(midi: number, when = 0, dur = 0.8, vol = 0.8): void {
  const c = getContext();
  const out = output();
  if (!c || !out) return;
  const t = Math.max(when, c.currentTime);
  const hit = state === "ready" ? nearestSample(midi) : null;
  if (!hit) {
    synth(c, out, midi, t, dur, vol * 0.33);
    return;
  }
  const [root, buf] = hit;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.pow(2, (midi - root) / 12);
  const g = c.createGain();
  const hold = Math.max(0.08, Math.min(dur, 8));
  const level = 0.15 + 0.85 * vol;
  g.gain.setValueAtTime(level, t);
  // Damper: a short release when the key comes up.
  g.gain.setTargetAtTime(0.0001, t + hold, 0.09);
  src.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + hold + 0.8);
}

function synth(c: AudioContext, out: AudioNode, m: number, t: number, dur: number, v: number): void {
  const f = 440 * Math.pow(2, (m - 69) / 12);
  const hold = Math.max(0.09, Math.min(dur, 6));
  const ring = Math.max(0.7, Math.min(4.2, 4.2 - (m - 36) * 0.055));
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(v, t + 0.006);
  env.gain.setTargetAtTime(v * 0.22, t + 0.006, ring / 3);
  env.gain.setTargetAtTime(0.0001, t + hold, 0.075);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(Math.min(12000, f * 8 + 1200), t);
  lp.frequency.setTargetAtTime(Math.max(f * 2.2, 700), t + 0.01, 0.35);
  const end = t + hold + 0.6;
  const partials: [number, number, OscillatorType][] = [
    [1, 1, "triangle"],
    [2.0015, 0.3, "sine"],
    [3.004, 0.09, "sine"],
  ];
  for (const [mul, gain, type] of partials) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = f * mul;
    g.gain.value = gain;
    o.connect(g);
    g.connect(lp);
    o.start(t);
    o.stop(end);
  }
  lp.connect(env);
  env.connect(out);
}
