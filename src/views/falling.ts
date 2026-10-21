import { type Pass, passesFor, playLength, type Strike, strikesFor } from "../core/score";
import type { Hand, Note, Score } from "../core/types";
import { EPS } from "../core/types";
import { type RGB, luminance, rgba, shade } from "./color";
import { Effects } from "./effects";
import type { KeyLayout } from "./keyLayout";

export interface FallingStyle {
  colors: [RGB, RGB];
  /** Hands the app plays; the other hand is yours and drawn a little softer. */
  heard: [boolean, boolean];
  effects: boolean;
  fingers: boolean;
  names: boolean;
  label: (n: Note) => string;
}

export interface FallingTime {
  /** Quarter notes since the selection start as played (negative while counting in). */
  raw: number;
  /** Seconds per quarter note. */
  spq: number;
  playing: boolean;
  loop: boolean;
}

/** Notes currently under the hit line, keyed by note, time it is played and loop pass. */
export interface HitNote {
  n: Note;
  key: string;
}

/** Seconds of music visible above the keyboard. */
const WINDOW_SECONDS = 3.2;

/**
 * Synthesia-style view: bars fall onto the keys. Time runs in quarter notes;
 * the speed on screen is constant in seconds, so slow tempos spread notes out.
 */
export class FallingView {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layout: KeyLayout | null = null;
  private score: Score | null = null;
  private passes: Pass[] = [];
  private strikes: Strike[] = [];
  private loopLen = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private fx = new Effects();
  private lit = new Set<string>();
  private lastT = 0;
  private pxPerQ = 0;
  /** Wheel, trackpad or a drag moved the notes, in quarter notes: positive looks ahead. */
  onScroll: ((dq: number) => void) | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "falling";
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(this.el);
    // Scrolling up, or dragging the notes down, brings the coming notes in, as if time ran on.
    this.el.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
        e.preventDefault();
        this.scroll(-e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1));
      },
      { passive: false },
    );
    let dragY: number | null = null;
    this.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragY = e.clientY;
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener("pointermove", (e) => {
      if (dragY == null) return;
      this.scroll(e.clientY - dragY);
      dragY = e.clientY;
    });
    const drop = () => (dragY = null);
    this.el.addEventListener("pointerup", drop);
    this.el.addEventListener("pointercancel", drop);
  }

  private scroll(px: number): void {
    if (px && this.pxPerQ) this.onScroll?.(px / this.pxPerQ);
  }

  setLayout(l: KeyLayout): void {
    this.layout = l;
  }

  setSelection(score: Score, from: number, to: number): void {
    this.score = score;
    this.passes = passesFor(score, from, to);
    this.loopLen = playLength(score, this.passes);
    // Key presses as played: tie continuations are drawn as part of their head, unless that wasn't just played.
    this.strikes = strikesFor(score, this.passes);
    this.lit.clear();
    this.fx.clear();
  }

  /** True while particles still need frames after playback stopped. */
  get animating(): boolean {
    return this.fx.active;
  }

  private resize(): void {
    const rect = this.el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
  }

  /** Draws one frame and returns the notes under the hit line. */
  render(t: FallingTime, st: FallingStyle): HitNote[] {
    const g = this.ctx;
    const L = this.layout;
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, this.lastT ? now - this.lastT : 0);
    this.lastT = now;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.w;
    const H = this.h;
    g.clearRect(0, 0, W, H);
    if (!L || !this.score || !W) return [];

    // backdrop
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#05050a");
    bg.addColorStop(1, "#0d0a18");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // octave lanes
    g.fillStyle = "rgba(255,255,255,0.045)";
    for (const m of L.whites) if (m % 12 === 0) g.fillRect(Math.round(L.get(m)!.x), 0, 1, H);

    const pxPerQ = (H / WINDOW_SECONDS) * t.spq;
    this.pxPerQ = pxPerQ;
    const yOf = (rel: number) => H - (rel - t.raw) * pxPerQ;
    const loopOn = t.loop && this.loopLen > EPS;
    const loops: number[] = [];
    if (loopOn) {
      const k0 = Math.max(0, Math.floor(t.raw / this.loopLen));
      loops.push(k0, k0 + 1);
      if (t.raw - k0 * this.loopLen < 0.25) loops.unshift(k0 - 1);
    } else loops.push(0);

    // bar lines with numbers, in the order the bars are played
    g.font = "600 11px Inter Variable, system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "bottom";
    const M = this.score.measures;
    for (const k of loops) {
      if (k < 0) continue;
      const off = k * this.loopLen;
      for (let i = 0; i <= this.passes.length; i++) {
        const p = this.passes[i];
        const y = yOf((p ? p.at : this.loopLen) + off);
        if (y < -2 || y > H + 1) continue;
        g.fillStyle = p ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.16)";
        g.fillRect(0, Math.round(y), W, 1);
        if (p) {
          g.fillStyle = "rgba(255,255,255,0.32)";
          g.fillText(M[p.m].label, 6, y - 3);
        }
      }
    }

    // notes
    const hits: HitNote[] = [];
    const nowLit = new Set<string>();
    const colorFor = (hand: Hand) => st.colors[hand];
    for (const k of loops) {
      if (k < 0) continue;
      const off = k * this.loopLen;
      for (const s of this.strikes) {
        const n = s.n;
        const geo = L.get(n.sound);
        if (!geo) continue;
        let a = s.t + off;
        let b = a + Math.max(n.remain, 0);
        if (n.grace) {
          const sec = 0.06 * (n.graceRank || 1);
          a -= sec / t.spq;
          b = a + 0.09 / t.spq;
        }
        b = Math.min(b, off + this.loopLen);
        const yb = yOf(a);
        const yt = yOf(b);
        if (yt > H || yb < 0) continue;
        const on = t.playing && a <= t.raw + EPS && t.raw < b - EPS;
        const color = colorFor(n.staff);
        const mine = !st.heard[n.staff];
        const pad = geo.black ? 0.5 : Math.max(1, geo.w * 0.08);
        const x = geo.x + pad;
        const w = geo.w - pad * 2;
        const top = Math.max(yt, -4);
        const bot = Math.min(yb, H);
        const hgt = Math.max(bot - top, 3);

        if (st.effects) {
          // neon halo: every bar glows a little, the sounding ones a lot
          const s = this.fx.sprite(color);
          const spread = on ? 22 : 12;
          g.save();
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = on ? 0.75 : mine ? 0.14 : 0.26;
          g.drawImage(s, x - spread, top - spread, w + spread * 2, hgt + spread * 2);
          g.restore();
        }
        const base = geo.black ? shade(color, -0.32) : color;
        const grd = g.createLinearGradient(x, 0, x + w, 0);
        grd.addColorStop(0, rgba(shade(base, on ? 0.35 : 0.12), mine ? 0.72 : 1));
        grd.addColorStop(1, rgba(shade(base, on ? 0.1 : -0.12), mine ? 0.72 : 1));
        g.fillStyle = grd;
        roundRect(g, x, top, w, hgt, Math.min(6, w / 2.6));
        g.fill();
        g.strokeStyle = rgba(shade(base, 0.55), on ? 0.9 : mine ? 0.35 : 0.5);
        g.lineWidth = 1;
        g.stroke();
        if (on) {
          // hot core while the key is down
          const core = g.createLinearGradient(0, bot, 0, top);
          core.addColorStop(0, "rgba(255,255,255,0.55)");
          core.addColorStop(0.35, "rgba(255,255,255,0.12)");
          core.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = core;
          roundRect(g, x, top, w, hgt, Math.min(6, w / 2.6));
          g.fill();
        }

        // finger and name at the bottom of the bar
        const parts: string[] = [];
        if (st.fingers && n.finger != null && !n.grace) parts.push(String(n.finger));
        if (st.names && !n.grace) parts.push(st.label(n));
        if (parts.length && hgt > 14) {
          const fs = Math.max(9, Math.min(13, w * 0.5));
          g.font = `700 ${fs}px Inter Variable, system-ui, sans-serif`;
          g.textAlign = "center";
          g.textBaseline = "bottom";
          g.fillStyle = luminance(base) > 0.6 ? "rgba(10,10,20,0.85)" : "rgba(255,255,255,0.95)";
          const cx = x + w / 2;
          let ly = bot - 4;
          for (const p of parts) {
            if (ly - fs < top + 2) break;
            g.fillText(p, cx, ly);
            ly -= fs + 2;
          }
        }

        if (on) {
          const key = n.id + "@" + s.t + "@" + k;
          nowLit.add(key);
          hits.push({ n, key });
          if (st.effects) {
            const cx = geo.x + geo.w / 2;
            if (!this.lit.has(key)) this.fx.burst(cx, H - 2, color, geo.w);
            else this.fx.emit(cx, H - 2, color, geo.w, dt);
          }
        }
      }
    }
    this.lit = nowLit;

    // hit line and flares
    const line = g.createLinearGradient(0, 0, W, 0);
    line.addColorStop(0, rgba(st.colors[1], 0.35));
    line.addColorStop(0.5, "rgba(255,255,255,0.45)");
    line.addColorStop(1, rgba(st.colors[0], 0.35));
    g.fillStyle = line;
    g.fillRect(0, H - 2, W, 2);
    if (st.effects) {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const h of hits) {
        const geo = L.get(h.n.sound);
        if (!geo) continue;
        const s = this.fx.sprite(colorFor(h.n.staff));
        const cx = geo.x + geo.w / 2;
        g.globalAlpha = 0.9;
        g.drawImage(s, cx - geo.w * 2.2, H - 34, geo.w * 4.4, 68);
      }
      g.restore();
      this.fx.update(dt);
      this.fx.draw(g);
    } else if (this.fx.active) this.fx.clear();
    return hits;
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, h / 2, w / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
