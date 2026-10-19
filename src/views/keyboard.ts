import type { Hand } from "../core/types";
import { type RGB, luminance, rgba, shade } from "./color";
import { KeyLayout } from "./keyLayout";

export interface KeyMark {
  hand: Hand;
  color: RGB;
  finger: number | null;
  name: string;
}

export interface KeyboardFrame {
  /** Keys sounding now. */
  active: Map<number, KeyMark>;
  /** Next keys per hand, shown as dim finger badges. */
  upcoming: Map<number, KeyMark>;
  /** Keys used in the selected bars, tinted lightly (sheet view). */
  ghost: Map<number, RGB>;
  /** Key of the note picked in the sheet. */
  picked: number | null;
  showNames: boolean;
  showFingers: boolean;
  /** Label for a key when names are shown (and for the C landmarks). */
  label: (midi: number) => string;
}

const BLACK_DEPTH = 0.63;
const STRIP = 30;

/** Canvas keyboard with lit keys, note names and finger numbers in a strip below. */
export class KeyboardView {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layout: KeyLayout | null = null;
  private range: [number, number] = [48, 84];
  private dpr = 1;
  private w = 0;
  private h = 0;
  private stripOn = true;
  private last: KeyboardFrame | null = null;
  onLayout: ((l: KeyLayout) => void) | null = null;
  onPress: ((midi: number) => void) | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "keyboard";
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Piano keyboard");
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.layout) return;
      const r = this.canvas.getBoundingClientRect();
      const keysH = this.h - (this.stripOn ? STRIP : 0);
      const y = e.clientY - r.top;
      if (y > keysH) return;
      const midi = this.layout.hit(e.clientX - r.left, y / keysH, BLACK_DEPTH);
      if (midi != null) this.onPress?.(midi);
    });
  }

  setRange(lo: number, hi: number): void {
    this.range = [lo, hi];
    this.resize();
  }

  setStrip(on: boolean): void {
    if (on === this.stripOn) return;
    this.stripOn = on;
    this.el.classList.toggle("no-strip", !on);
    this.resize();
  }

  getLayout(): KeyLayout | null {
    return this.layout;
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
    this.layout = new KeyLayout(this.range[0], this.range[1], this.w);
    this.onLayout?.(this.layout);
    if (this.last) this.draw(this.last);
  }

  draw(f: KeyboardFrame): void {
    this.last = f;
    const L = this.layout;
    if (!L) return;
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const keysH = this.h - (this.stripOn ? STRIP : 0);
    const bh = keysH * BLACK_DEPTH;
    const radius = Math.min(6, L.whiteW * 0.18);
    const fontPx = Math.max(8, Math.min(13, L.whiteW * 0.42));

    // White keys
    for (const m of L.whites) {
      const k = L.get(m)!;
      const act = f.active.get(m);
      const ghost = f.ghost.get(m);
      const grd = g.createLinearGradient(0, 0, 0, keysH);
      if (act) {
        grd.addColorStop(0, rgba(shade(act.color, 0.35)));
        grd.addColorStop(0.7, rgba(act.color));
        grd.addColorStop(1, rgba(shade(act.color, -0.15)));
      } else {
        grd.addColorStop(0, "#d9d9e3");
        grd.addColorStop(0.08, "#f3f3f8");
        grd.addColorStop(0.92, "#ffffff");
        grd.addColorStop(1, "#cfd0da");
      }
      g.fillStyle = grd;
      roundRectBottom(g, k.x + 0.5, 0, k.w - 1, keysH, radius);
      g.fill();
      if (!act && ghost) {
        g.fillStyle = rgba(ghost, 0.2);
        roundRectBottom(g, k.x + 0.5, 0, k.w - 1, keysH, radius);
        g.fill();
      }
      if (f.picked === m) {
        g.strokeStyle = "#ffffff";
        g.lineWidth = 2;
        roundRectBottom(g, k.x + 2, 1, k.w - 4, keysH - 2, radius);
        g.stroke();
      }
    }

    // Black keys
    for (const k of L.keys.values()) {
      if (!k.black) continue;
      const act = f.active.get(k.midi);
      const ghost = f.ghost.get(k.midi);
      const grd = g.createLinearGradient(0, 0, 0, bh);
      if (act) {
        grd.addColorStop(0, rgba(shade(act.color, -0.25)));
        grd.addColorStop(1, rgba(act.color));
      } else if (ghost) {
        grd.addColorStop(0, rgba(shade(ghost, -0.7)));
        grd.addColorStop(1, rgba(shade(ghost, -0.45)));
      } else {
        grd.addColorStop(0, "#08080c");
        grd.addColorStop(0.85, "#24242e");
        grd.addColorStop(1, "#33333f");
      }
      g.fillStyle = grd;
      roundRectBottom(g, k.x, 0, k.w, bh, Math.min(4, radius));
      g.fill();
      if (!act) {
        // top bevel highlight
        g.fillStyle = "rgba(255,255,255,0.07)";
        g.fillRect(k.x + k.w * 0.18, bh * 0.05, k.w * 0.64, bh * 0.78);
      }
      if (f.picked === k.midi) {
        g.strokeStyle = "#ffffff";
        g.lineWidth = 2;
        roundRectBottom(g, k.x + 1, 0, k.w - 2, bh - 1, Math.min(4, radius));
        g.stroke();
      }
    }

    // felt shadow along the top
    const sh = g.createLinearGradient(0, 0, 0, 10);
    sh.addColorStop(0, "rgba(0,0,0,0.55)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sh;
    g.fillRect(0, 0, this.w, 10);

    // Names: C landmarks always, every white key when names are on, lit keys in bold.
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    for (const m of L.whites) {
      const k = L.get(m)!;
      const act = f.active.get(m);
      const isC = m % 12 === 0;
      if (!act && !isC && !f.showNames) continue;
      const text = act && f.showNames ? act.name : f.label(m);
      if (act) {
        g.font = `700 ${fontPx}px Inter Variable, system-ui, sans-serif`;
        g.fillStyle = luminance(act.color) > 0.62 ? "rgba(10,10,18,0.9)" : "#ffffff";
      } else {
        g.font = `${isC ? 600 : 500} ${fontPx * 0.92}px Inter Variable, system-ui, sans-serif`;
        g.fillStyle = isC ? "rgba(20,20,32,0.62)" : "rgba(20,20,32,0.42)";
      }
      if (!act || f.showNames || isC) g.fillText(text, k.x + k.w / 2, keysH - 8);
    }
    if (f.showNames) {
      for (const [m, act] of f.active) {
        const k = L.get(m);
        if (!k || !k.black) continue;
        g.font = `700 ${fontPx * 0.8}px Inter Variable, system-ui, sans-serif`;
        g.fillStyle = luminance(act.color) > 0.62 ? "rgba(10,10,18,0.9)" : "#ffffff";
        g.fillText(act.name, k.x + k.w / 2, bh - 7);
      }
    }

    // Finger strip
    if (this.stripOn && f.showFingers) {
      const cy = keysH + STRIP / 2 + 1;
      const r = Math.max(7, Math.min(11, L.whiteW * 0.4));
      g.font = `700 ${Math.round(r * 1.25)}px Inter Variable, system-ui, sans-serif`;
      g.textBaseline = "middle";
      const drawBadge = (m: number, mark: KeyMark, on: boolean) => {
        if (mark.finger == null) return;
        const x = L.center(m);
        // Black keys carry their badge on the key tip, so it never collides with a white neighbour's.
        const black = L.get(m)?.black;
        const y = black ? bh - r - 5 : cy;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        if (on) {
          g.fillStyle = rgba(mark.color);
          g.fill();
          g.fillStyle = luminance(mark.color) > 0.62 ? "#0b0b12" : "#ffffff";
        } else {
          g.fillStyle = black ? "rgba(10,10,16,0.85)" : "rgba(255,255,255,0.04)";
          g.fill();
          g.strokeStyle = rgba(mark.color, 0.55);
          g.lineWidth = 1.5;
          g.stroke();
          g.fillStyle = rgba(shade(mark.color, 0.3), 0.75);
        }
        g.fillText(String(mark.finger), x, y + 0.5);
      };
      for (const [m, mark] of f.upcoming) if (!f.active.has(m)) drawBadge(m, mark, false);
      for (const [m, mark] of f.active) drawBadge(m, mark, true);
    }
  }
}

function roundRectBottom(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.closePath();
}
