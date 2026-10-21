import { getContext, outputLatency, resume, silenceScheduled } from "../audio/engine";
import { click } from "../audio/metronome";
import { playNote } from "../audio/piano";
import { strikesIn } from "../core/score";
import type { Measure, Note, Score } from "../core/types";
import { EPS } from "../core/types";

export interface Hearing {
  right: boolean;
  left: boolean;
  click: boolean;
}

interface NoteEvent {
  kind: "note";
  t: number;
  g: number;
  n: Note;
  dur: number;
}
interface ClickEvent {
  kind: "click";
  t: number;
  g: 0;
  accent: boolean;
  count: boolean;
  beat: number;
}
type PlayEvent = NoteEvent | ClickEvent;

export interface Position {
  /** Quarter notes since the selection start, negative while counting in, not wrapped by the loop. */
  raw: number;
  /** Position in the score in quarter notes, wrapped into the selection. */
  absQ: number;
  /** Count-in beat (1, 2, …) or 0 once the music runs. */
  countBeat: number;
  /** Measure index under `absQ`. */
  measure: number;
}

/** Metronome clicks inside one bar, relative to its start; pickups count from the right beat. */
export function clicksFor(m: Measure): { t: number; accent: boolean }[] {
  const off = m.pickup ? m.nominal - m.durQ : 0;
  const out: { t: number; accent: boolean }[] = [];
  for (let k = 0; k * m.beatQ < m.nominal - EPS; k++) {
    const t = k * m.beatQ - off;
    if (t < -EPS || t > m.durQ - EPS) continue;
    out.push({ t, accent: k === 0 });
  }
  return out;
}

/** One bar of clicks before the first bar that lands exactly on a pickup, if there is one. */
export function countInFor(m: Measure): ClickEvent[] {
  const nom = m.nominal;
  const b = m.beatQ;
  let len = nom - (m.pickup ? m.durQ : 0);
  if (len < nom / 2 - EPS) len += nom;
  const out: ClickEvent[] = [];
  for (let k = 0; k * b < len - EPS; k++) {
    const inBar = (k * b) % nom;
    out.push({
      kind: "click",
      t: k * b - len,
      g: 0,
      count: true,
      accent: inBar < EPS,
      beat: Math.round(inBar / b) + 1,
    });
  }
  return out;
}

/**
 * Look-ahead sequencer: a 30 ms timer schedules notes up to 300 ms ahead on the
 * audio clock, so playback stays tight even when drawing stutters.
 */
export class Transport {
  running = false;
  loop = true;
  hearing: Hearing = { right: true, left: true, click: true };
  onStop: (() => void) | null = null;

  private score: Score | null = null;
  private from = 0;
  private to = 0;
  private startQ = 0;
  private timer = 0;
  private anchorAudio = 0;
  private anchorQ = 0;
  private spq = 1;
  private events: PlayEvent[] = [];
  private countEvents: ClickEvent[] = [];
  private list: PlayEvent[] = [];
  private idx = 0;
  private base = 0;
  private endQ: number | null = null;
  loopLen = 0;

  private qToAudio(q: number) {
    return this.anchorAudio + (q - this.anchorQ) * this.spq;
  }
  private audioToQ(a: number) {
    return this.anchorQ + (a - this.anchorAudio) / this.spq;
  }

  /** Seconds per quarter note at the current tempo. */
  get secondsPerQuarter(): number {
    return this.spq;
  }

  start(score: Score, from: number, to: number, opts: { bpm: number; countIn: boolean }): boolean {
    const c = resume();
    if (!c) return false;
    this.stop(false);
    const M = score.measures;
    this.score = score;
    this.from = from;
    this.to = to;
    this.startQ = M[from].startQ;
    this.loopLen = M[to].startQ + M[to].durQ - this.startQ;
    const ev: PlayEvent[] = [];
    // A tie from before the selection still sounds from its first bar inside it.
    for (const n of strikesIn(score, from, to)) {
      ev.push({ kind: "note", t: n.q - this.startQ, g: n.grace ? n.graceRank || 1 : 0, n, dur: n.remain });
    }
    for (let mi = from; mi <= to; mi++) {
      for (const ck of clicksFor(M[mi])) {
        ev.push({
          kind: "click",
          t: M[mi].startQ - this.startQ + ck.t,
          g: 0,
          accent: ck.accent,
          count: false,
          beat: 0,
        });
      }
    }
    ev.sort((a, b) => a.t - b.t || b.g - a.g);
    this.events = ev;
    this.countEvents = opts.countIn ? countInFor(M[from]) : [];
    this.list = this.countEvents.length ? this.countEvents : this.events;
    this.idx = 0;
    this.base = 0;
    this.endQ = null;
    this.spq = 60 / opts.bpm;
    this.anchorQ = this.countEvents.length ? this.countEvents[0].t : 0;
    this.anchorAudio = c.currentTime + 0.12;
    this.running = true;
    this.pump();
    return true;
  }

  stop(notify = true): void {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.timer);
    silenceScheduled();
    if (notify) this.onStop?.();
  }

  /** Changes tempo without a jump: the current position becomes the new anchor. */
  setTempo(bpm: number): void {
    const c = getContext();
    if (this.running && c) {
      const nowQ = this.audioToQ(c.currentTime);
      this.anchorAudio = c.currentTime;
      this.anchorQ = nowQ;
    }
    this.spq = 60 / bpm;
  }

  /** Where the music is right now, as heard (output latency included). */
  position(): Position | null {
    const c = getContext();
    if (!this.running || !c || !this.score) return null;
    const raw = this.audioToQ(c.currentTime - outputLatency());
    return this.describe(raw);
  }

  /** Builds a position for a raw offset, also used to draw the stopped state. */
  describe(raw: number): Position {
    const M = this.score!.measures;
    if (raw < 0) {
      let beat = 0;
      for (const e of this.countEvents) if (e.t <= raw + EPS) beat = e.beat;
      return { raw, absQ: this.startQ + raw, countBeat: this.running ? beat : 0, measure: this.from };
    }
    const absQ =
      this.startQ + (this.loop && this.loopLen > EPS ? raw % this.loopLen : Math.min(raw, this.loopLen));
    let mi = this.from;
    while (mi < this.to && M[mi + 1].startQ <= absQ + EPS) mi++;
    return { raw, absQ, countBeat: 0, measure: mi };
  }

  private pump = (): void => {
    if (!this.running) return;
    const c = getContext()!;
    const horizon = c.currentTime + 0.3;
    for (let guard = 0; guard < 20000; guard++) {
      const ev = this.list[this.idx];
      if (!ev) {
        if (this.list === this.countEvents) {
          this.list = this.events;
          this.idx = 0;
          continue;
        }
        if (this.loop && this.loopLen > EPS) {
          this.base += this.loopLen;
          this.idx = 0;
          continue;
        }
        if (this.endQ == null) this.endQ = this.base + this.loopLen;
        break;
      }
      const at = this.qToAudio(this.base + ev.t) - (ev.g ? 0.06 * ev.g : 0);
      if (at > horizon) break;
      if (at >= c.currentTime - 0.02) this.fire(ev, at);
      this.idx++;
    }
    if (this.endQ != null && this.audioToQ(c.currentTime - outputLatency()) >= this.endQ - EPS) {
      this.stop();
      return;
    }
    this.timer = window.setTimeout(this.pump, 30);
  };

  private fire(ev: PlayEvent, at: number): void {
    if (ev.kind === "click") {
      if (this.hearing.click || ev.count) click(at, ev.accent);
      return;
    }
    const n = ev.n;
    if (n.staff === 0 ? !this.hearing.right : !this.hearing.left) return;
    const dur = ev.g ? 0.09 : Math.min(ev.dur * this.spq, 6) * 0.98;
    playNote(n.sound, at, dur, n.staff === 0 ? 0.75 : 0.5);
  }
}

/** Notes sounding at `absQ` inside the selection (grace notes are too short to show). */
export function soundingAt(notes: Note[], absQ: number): Note[] {
  const out: Note[] = [];
  for (const n of notes) if (!n.grace && n.q <= absQ + EPS && absQ < n.q + n.dur - EPS) out.push(n);
  return out;
}
