/* eslint-disable @typescript-eslint/no-explicit-any -- OSMD's graphical model is untyped where we reach into it */
import type { Note, Score } from "../core/types";

const SVGNS = "http://www.w3.org/2000/svg";

export interface SheetOverlay {
  fingers: boolean;
  names: boolean;
  label: (n: Note) => string;
}

interface Placed {
  n: Note;
  el: SVGGElement;
  x: number;
  y: number;
  box: DOMRect;
  beams: DOMRect[];
}

interface View {
  svg: SVGSVGElement;
  byId: Map<string, Placed>;
  list: Placed[];
  staff: Map<string, { top: number; bot: number }>;
  labels: Map<string, SVGTextElement[]>;
  scale: number;
  vb: { x: number; y: number; w: number; h: number } | null;
}

type OSMDModule = typeof import("opensheetmusicdisplay");
let osmdModule: Promise<OSMDModule> | null = null;
const loadOSMD = () => (osmdModule ??= import("opensheetmusicdisplay"));

/** Sheet music for the selected bars on one long line, with our own fingering and note-name layer. */
export class SheetView {
  readonly el: HTMLDivElement;
  private scroller: HTMLDivElement;
  private inner: HTMLDivElement;
  private msg: HTMLParagraphElement;
  private osmd: any = null;
  private score: Score | null = null;
  private text = "";
  private loadedText = "";
  private from = 0;
  private to = 0;
  private view: View | null = null;
  private overlay: SheetOverlay = { fingers: true, names: false, label: () => "" };
  private playEls: Element[] = [];
  private scrollAt = 0;
  private dirty = true;
  picked: Note | null = null;
  onPick: ((n: Note | null) => void) | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "sheet";
    this.scroller = document.createElement("div");
    this.scroller.className = "sheet-scroll";
    this.inner = document.createElement("div");
    this.inner.className = "sheet-inner";
    this.msg = document.createElement("p");
    this.msg.className = "sheet-msg";
    this.scroller.appendChild(this.inner);
    this.el.append(this.scroller, this.msg);
    this.scroller.addEventListener("click", (e) => this.handleClick(e));
    let t = 0;
    new ResizeObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(() => this.fit(), 120);
    }).observe(this.el);
  }

  /** Remembers the MusicXML; rendering waits until the view is shown. */
  setSource(score: Score, text: string): void {
    this.score = score;
    this.text = text;
    this.dirty = true;
  }

  setSelection(from: number, to: number): void {
    this.from = from;
    this.to = to;
    this.picked = null;
    this.dirty = true;
  }

  setOverlay(o: SheetOverlay): void {
    this.overlay = o;
    this.drawOverlay();
  }

  /** Renders if anything changed since the last time it was visible. */
  async show(): Promise<void> {
    if (!this.dirty || !this.score) return;
    this.dirty = false;
    if (this.score.source !== "musicxml") {
      this.message("Sheet music needs a MusicXML file. MIDI files play in the falling notes view.");
      this.inner.innerHTML = "";
      this.view = null;
      return;
    }
    this.message("Setting the music …");
    try {
      const lib = await loadOSMD();
      if (!this.osmd) {
        this.osmd = new lib.OpenSheetMusicDisplay(this.inner, {
          backend: "svg",
          autoResize: false,
          pageFormat: "Endless",
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawLyricist: false,
          drawCredits: false,
          drawPartNames: false,
          drawPartAbbreviations: false,
          drawFingerings: false,
          drawMetronomeMarks: false,
          drawMeasureNumbers: true,
          measureNumberInterval: 1,
          useXMLMeasureNumbers: true,
          renderSingleHorizontalStaffline: true,
        } as any);
        this.osmd.setLogLevel?.("error");
      }
      if (this.loadedText !== this.text) {
        await this.osmd.load(this.text);
        this.loadedText = this.text;
        const used = this.score.usedParts;
        this.osmd.Sheet.Instruments.forEach((ins: any, i: number) => {
          ins.Visible = used.includes(i);
        });
      }
      this.render();
    } catch (e) {
      console.error(e);
      this.loadedText = "";
      this.view = null;
      this.message("This part of the score could not be drawn: " + ((e as Error).message || String(e)));
    }
  }

  private message(text: string): void {
    this.msg.textContent = text;
    this.msg.hidden = !text;
  }

  private render(): void {
    const r = this.osmd.EngravingRules;
    // With a pickup OSMD copies the *Number rules into the *Index rules on render, so set both.
    r.MinMeasureToDrawIndex = this.from;
    r.MaxMeasureToDrawIndex = this.to;
    r.MinMeasureToDrawNumber = this.from;
    r.MaxMeasureToDrawNumber = this.to;
    r.RenderMeasureNumbersOnlyAtSystemStart = false;
    r.BetweenStaffDistance = 8;
    r.PageLeftMargin = 1;
    r.PageRightMargin = 1;
    r.PageTopMargin = 1;
    this.osmd.zoom = 1;
    this.osmd.render();
    this.message("");
    this.collect();
    this.drawOverlay();
    this.scroller.scrollLeft = 0;
  }

  /** Matches our parsed notes to OSMD's graphical notes, bar by bar and staff by staff. */
  private collect(): void {
    const svg = this.inner.querySelector("svg");
    this.playEls = [];
    if (!svg || !this.score) {
      this.view = null;
      return;
    }
    const V: View = {
      svg,
      byId: new Map(),
      list: [],
      staff: new Map(),
      labels: new Map(),
      scale: 1,
      vb: null,
    };
    this.view = V;
    this.inner.querySelectorAll("div").forEach((d) => {
      (d as HTMLElement).style.width = "auto";
      (d as HTMLElement).style.height = "auto";
    });
    svg.removeAttribute("width");
    svg.removeAttribute("height");

    const sheet = this.osmd.Sheet;
    const srcIndex = new Map<any, number>();
    sheet.SourceMeasures.forEach((m: any, i: number) => srcIndex.set(m, i));
    const buckets = new Map<
      string,
      { rel: number; midi: number; grace: boolean; gn: any; used: boolean }[]
    >();
    for (const row of this.osmd.GraphicSheet.MeasureList) {
      if (!row) continue;
      for (const gm of row) {
        if (!gm?.parentSourceMeasure) continue;
        const mi = srcIndex.get(gm.parentSourceMeasure);
        if (mi == null || mi < this.from || mi > this.to) continue;
        const staff = gm.ParentStaff;
        const inst = staff?.ParentInstrument;
        if (!inst) continue;
        const st =
          this.score.staffMap[sheet.Instruments.indexOf(inst) + ":" + (inst.Staves.indexOf(staff) + 1)];
        if (st == null) continue;
        const key = mi + "|" + st;
        if (gm.stave?.getYForLine)
          V.staff.set(key, { top: gm.stave.getYForLine(0), bot: gm.stave.getYForLine(4) });
        const arr = buckets.get(key) ?? [];
        buckets.set(key, arr);
        for (const gse of gm.staffEntries || []) {
          const rel = gse.relInMeasureTimestamp ? gse.relInMeasureTimestamp.RealValue * 4 : 0;
          for (const gve of gse.graphicalVoiceEntries || []) {
            const grace = !!gve.parentVoiceEntry?.IsGrace;
            for (const gn of gve.notes || []) {
              const sn = gn.sourceNote;
              if (!sn?.Pitch || sn.isRest?.()) continue;
              arr.push({ rel, midi: sn.Pitch.getHalfTone() + 12, grace, gn, used: false });
            }
          }
        }
      }
    }

    const boxCache = new Map<Element, DOMRect>();
    const bbox = (el: SVGGraphicsElement) => {
      let b = boxCache.get(el);
      if (!b) {
        b = el.getBBox();
        boxCache.set(el, b);
      }
      return b;
    };
    const attach = (n: Note, gn: any) => {
      const el: SVGGElement | undefined = gn.getSVGGElement?.();
      if (!el) return;
      let x: number | null = null;
      let y: number | null = null;
      const vf = gn.vfnote?.[0];
      const idx = gn.vfnote ? gn.vfnote[1] || 0 : 0;
      const heads: SVGGraphicsElement[] = gn.getNoteheadSVGs ? gn.getNoteheadSVGs() : [];
      const head = heads[idx] || heads[0];
      if (head) {
        const hb = bbox(head);
        x = hb.x + hb.width / 2;
        y = hb.y + hb.height / 2;
      }
      if (vf?.getYs) {
        const ys = vf.getYs();
        if (ys?.[idx] != null) y = ys[idx];
      }
      const box = bbox(el);
      if (x == null || y == null) {
        x = box.x + box.width / 2;
        y = box.y + box.height / 2;
      }
      const beams = gn.getBeamSVGs ? (gn.getBeamSVGs() as SVGGraphicsElement[]).map(bbox) : [];
      const p: Placed = { n, el, x, y, box, beams };
      V.byId.set(n.id, p);
      V.list.push(p);
    };

    const parsed = new Map<string, Note[]>();
    for (const n of this.score.notes) {
      if (n.m < this.from || n.m > this.to) continue;
      const k = n.m + "|" + n.staff;
      const arr = parsed.get(k) ?? [];
      arr.push(n);
      parsed.set(k, arr);
    }
    for (const [k, list] of parsed) {
      const gl = buckets.get(k) ?? [];
      const rest: Note[] = [];
      for (const n of list) {
        const hit = gl.find(
          (g) => !g.used && g.midi === n.midi && g.grace === n.grace && Math.abs(g.rel - n.rel) < 0.01,
        );
        if (hit) {
          hit.used = true;
          attach(n, hit.gn);
        } else rest.push(n);
      }
      for (const n of rest) {
        let best: (typeof gl)[number] | null = null;
        let bd = Infinity;
        for (const g of gl) {
          if (g.used || g.midi !== n.midi || g.grace !== n.grace) continue;
          const d = Math.abs(g.rel - n.rel);
          if (d < bd) {
            bd = d;
            best = g;
          }
        }
        if (best) {
          best.used = true;
          attach(n, best.gn);
        }
      }
    }
  }

  private text_(parent: SVGGElement, x: number, y: number, str: string, cls: string, id: string): void {
    const t = document.createElementNS(SVGNS, "text");
    t.setAttribute("x", x.toFixed(1));
    t.setAttribute("y", y.toFixed(1));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", cls);
    t.textContent = str;
    parent.appendChild(t);
    const arr = this.view!.labels.get(id) ?? [];
    arr.push(t);
    this.view!.labels.set(id, arr);
  }

  /** Fingering above the right hand and below the left hand, note names under each staff. */
  drawOverlay(): void {
    const V = this.view;
    if (!V) return;
    V.svg.querySelector("g.ovl")?.remove();
    V.labels = new Map();
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "ovl");
    const ext = new Map<string, { top: number; bot: number; stack: number }>();
    for (const r of V.list) {
      const k = r.n.m + "|" + r.n.staff;
      const e = ext.get(k) ?? { top: Infinity, bot: -Infinity, stack: 1 };
      for (const b of [r.box, ...r.beams]) {
        e.top = Math.min(e.top, b.y);
        e.bot = Math.max(e.bot, b.y + b.height);
      }
      ext.set(k, e);
    }
    const cols = new Map<string, Placed[]>();
    for (const r of V.list) {
      if (r.n.cont) continue;
      const k = r.n.m + "|" + r.n.staff + "|" + Math.round(r.x / 3);
      const arr = cols.get(k) ?? [];
      arr.push(r);
      cols.set(k, arr);
    }
    for (const col of cols.values()) {
      const n0 = col[0].n;
      const e = ext.get(n0.m + "|" + n0.staff)!;
      e.stack = Math.max(e.stack, col.filter((r) => r.n.finger != null).length);
    }
    const LINE = 13;
    const NLINE = 12;
    const O = this.overlay;
    for (const col of cols.values()) {
      col.sort((a, b) => b.n.sound - a.n.sound);
      const n0 = col[0].n;
      const k = n0.m + "|" + n0.staff;
      const e = ext.get(k)!;
      const sy = V.staff.get(k) ?? { top: e.top, bot: e.bot };
      const x = col[0].x;
      if (O.fingers) {
        const items = col.filter((r) => r.n.finger != null);
        items.forEach((r, i) => {
          const cls = "fg" + (r.n.fingerSrc === "auto" ? "" : " fixed");
          const y =
            n0.staff === 0
              ? Math.min(sy.top - 14, e.top - 9) - (items.length - 1 - i) * LINE
              : Math.max(sy.bot + 24, e.bot + 18) + i * LINE;
          this.text_(g, r.x, y, String(r.n.finger), cls, r.n.id);
        });
      }
      if (O.names) {
        const base =
          n0.staff === 0
            ? Math.max(sy.bot + 17, e.bot + 14)
            : Math.max(sy.bot + 24, e.bot + 18) + (O.fingers ? e.stack * LINE + 4 : 0);
        col.forEach((r, i) => this.text_(g, x, base + i * NLINE, O.label(r.n), "nn", r.n.id));
      }
    }
    V.svg.appendChild(g);
    this.fit();
    if (this.picked) this.markPick(this.picked);
  }

  /** Scales the line of music to fill the stage height; long passages scroll sideways. */
  private fit(): void {
    const V = this.view;
    if (!V) return;
    const bb = V.svg.getBBox();
    const vb = { x: bb.x - 14, y: bb.y - 12, w: bb.width + 28, h: bb.height + 24 };
    V.svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const ch = this.scroller.clientHeight - 16;
    const cw = this.scroller.clientWidth - 2;
    const byHeight = ch / vb.h;
    const byWidth = cw / vb.w;
    // As big as the height allows, but no smaller than fitting the width, within readable limits.
    const scale = Math.max(0.9, Math.min(2.6, byHeight, Math.max(byWidth, 1.3)));
    V.svg.style.width = vb.w * scale + "px";
    V.svg.style.height = vb.h * scale + "px";
    V.scale = scale;
    V.vb = vb;
  }

  highlight(notes: Note[]): void {
    for (const x of this.playEls) x.classList.remove("play-r", "play-l");
    this.playEls = [];
    const V = this.view;
    if (!V) return;
    for (const n of notes) {
      const cls = n.staff === 0 ? "play-r" : "play-l";
      const r = V.byId.get(n.id);
      if (r) {
        r.el.classList.add(cls);
        this.playEls.push(r.el);
      }
      for (const t of V.labels.get(n.id) ?? []) {
        t.classList.add(cls);
        this.playEls.push(t);
      }
    }
    this.follow(notes);
  }

  private follow(on: Note[]): void {
    const V = this.view;
    if (!V?.vb || !on.length) return;
    const r = V.byId.get(on[0].id);
    if (!r) return;
    const px = (r.x - V.vb.x) * V.scale;
    const left = this.scroller.scrollLeft;
    const w = this.scroller.clientWidth;
    const now = performance.now();
    if ((px > left + w * 0.72 || px < left + 16) && now - this.scrollAt > 350) {
      this.scrollAt = now;
      this.scroller.scrollTo({ left: Math.max(0, px - w * 0.2), behavior: px < left ? "auto" : "smooth" });
    }
  }

  private handleClick(e: MouseEvent): void {
    const V = this.view;
    if (!V?.list.length) return;
    const ctm = V.svg.getScreenCTM();
    if (!ctm) return;
    const pt = V.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    let best: Placed | null = null;
    let bd = 24 * 24;
    for (const r of V.list) {
      const dx = r.x - p.x;
      const dy = (r.y - p.y) * 0.8;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    this.pick(best ? best.n : null);
  }

  pick(n: Note | null): void {
    this.picked = n;
    this.markPick(n);
    this.onPick?.(n);
  }

  private markPick(n: Note | null): void {
    const V = this.view;
    if (!V) return;
    V.svg.querySelectorAll(".pick").forEach((x) => x.classList.remove("pick"));
    if (!n) return;
    V.byId.get(n.id)?.el.classList.add("pick");
    for (const t of V.labels.get(n.id) ?? []) t.classList.add("pick");
  }

  /** Next or previous note in the same hand. */
  movePick(dir: 1 | -1): void {
    const V = this.view;
    const cur = this.picked;
    if (!V || !cur) return;
    const same = V.list
      .filter((r) => r.n.staff === cur.staff && !r.n.cont)
      .sort(
        (a, b) =>
          a.n.q - b.n.q || (a.n.grace === b.n.grace ? 0 : a.n.grace ? -1 : 1) || b.n.sound - a.n.sound,
      );
    const i = same.findIndex((r) => r.n === cur);
    const next = same[i + dir];
    if (next) this.pick(next.n);
  }
}
