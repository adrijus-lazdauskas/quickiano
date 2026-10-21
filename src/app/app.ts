import { resume } from "../audio/engine";
import { activatePiano, playNote, prefetchPiano } from "../audio/piano";
import { computeFingering, type FingerOverrides, tieHead } from "../core/fingering";
import { isMidi, parseMidi } from "../core/midi";
import { bytesToScoreText, hashBytes, hashText } from "../core/mxl";
import { parseMusicXML } from "../core/musicxml";
import { strikesIn, titleFromFileName, UNTITLED } from "../core/score";
import { fullName, keyName, pitchName, soundingSpelling, spellMidi } from "../core/noteNames";
import type { Hand, Note, Score } from "../core/types";
import { EPS } from "../core/types";
import { soundingAt, Transport } from "../player/transport";
import { S } from "../ui/strings";
import { ICON } from "../ui/icons";
import { renderLayout } from "../ui/layout";
import { hexToRgb, type RGB } from "../views/color";
import { FallingView } from "../views/falling";
import { type KeyMark, KeyboardView } from "../views/keyboard";
import { rangeFor } from "../views/keyLayout";
import { SheetView } from "../views/sheet";
import {
  forgetLast,
  getSong,
  lastSongId,
  loadFingers,
  loadRange,
  recentSongs,
  removeSong,
  saveFingers,
  saveRange,
  saveSong,
  type SongRecord,
} from "./library";
import { ConvertError, convertPdf, converterAvailable, type ConvertResult } from "./converter";
import { BPM_MAX, PALETTES, type Settings, SettingsStore } from "./settings";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TOGGLES: [string, keyof Settings][] = [
  ["tLoop", "loop"],
  ["tCount", "countIn"],
  ["tRight", "hearRight"],
  ["tLeft", "hearLeft"],
  ["tClick", "click"],
  ["tNames", "noteNames"],
  ["tFingers", "fingering"],
];

/** Seconds of falling notes shown before the first one while stopped at the start. */
const PREROLL_SECONDS = 0.7;

export class App {
  private settings = new SettingsStore();
  private transport = new Transport();
  private keyboard = new KeyboardView();
  private falling = new FallingView();
  private sheet = new SheetView();

  private score: Score | null = null;
  private song: SongRecord | null = null;
  private overrides: FingerOverrides = {};
  private from = 0;
  private to = 0;
  private anchor: number | null = null;
  private selNotes: Note[] = [];
  private attacks: [Note[], Note[]] = [[], []];
  private colors: [RGB, RGB] = [
    [255, 79, 216],
    [139, 92, 255],
  ];
  private preferFlats = false;
  /** Where playing goes on from while stopped, in quarters into the selection; null is its start. */
  private cursor: number | null = null;
  private raf = 0;
  private kbSig = "";
  private sheetSig = "";
  private nowBar = -1;
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    renderLayout(root);
    const host = $("viewHost");
    host.prepend(this.falling.el, this.sheet.el);
    $("stage").appendChild(this.keyboard.el);
    this.keyboard.onLayout = (l) => {
      this.falling.setLayout(l);
      this.kbSig = "";
      this.requestFrame();
    };
    this.keyboard.onPress = (m) => {
      this.unlockAudio();
      playNote(m, 0, 1, 0.7);
    };
    this.sheet.onPick = (n) => this.onPick(n);
    this.transport.onStop = () => {
      this.cursor = null;
      this.paintPlay();
      this.requestFrame();
    };

    this.bindControls();
    this.bindSettingsPanel();
    this.bindFiles();
    this.bindPdf();
    this.bindKeys();
    this.settings.subscribe((s, changed) => this.applySettings(s, changed));
    this.applySettings(this.settings.get(), Object.keys(this.settings.get()) as (keyof Settings)[]);
    prefetchPiano(import.meta.env.BASE_URL + "samples/piano/");
    void this.restore();
  }

  /* ---------- audio unlock ---------- */

  private unlocked = false;
  private unlockAudio(): void {
    resume();
    if (this.unlocked) return;
    this.unlocked = true;
    void activatePiano();
  }

  /* ---------- songs ---------- */

  private async restore(): Promise<void> {
    void this.paintRecent();
    const id = lastSongId();
    const rec = id ? await getSong(id) : null;
    if (rec) {
      try {
        await this.openRecord(rec);
        return;
      } catch {
        forgetLast();
      }
    }
    this.setState("empty");
  }

  private async openFile(file: File): Promise<void> {
    if (/\.pdf$/i.test(file.name)) {
      if (converterAvailable()) void this.convert(file);
      else $<HTMLDialogElement>("pdfDialog").showModal();
      return;
    }
    try {
      await this.openData(await file.arrayBuffer(), file.name);
    } catch (e) {
      this.toast(S.loadFailed + " " + ((e as Error).message || ""), true);
    }
  }

  private async openDemo(file: string): Promise<void> {
    try {
      const res = await fetch(import.meta.env.BASE_URL + "demos/" + file);
      if (!res.ok) throw new Error(res.statusText);
      await this.openData(await res.arrayBuffer(), file);
    } catch (e) {
      this.toast(S.loadFailed + " " + ((e as Error).message || ""), true);
    }
  }

  private async openData(buf: ArrayBuffer, fileName: string): Promise<void> {
    const { score, rec, text } = await this.readSong(buf, fileName);
    this.useScore(score, rec, text);
    if (!(await saveSong(rec))) this.toast(S.notSaved);
    void this.paintRecent();
  }

  /** Reads a MusicXML, .mxl or MIDI file into a score and the record that keeps it. */
  private async readSong(
    buf: ArrayBuffer,
    fileName: string,
  ): Promise<{ score: Score; rec: SongRecord; text: string }> {
    const u8 = new Uint8Array(buf);
    if (isMidi(u8)) {
      const score = parseMidi(buf, fileName);
      return { score, rec: this.recordFor(score, hashBytes(u8), fileName, "midi", buf.slice(0)), text: "" };
    }
    const text = await bytesToScoreText(buf);
    const score = this.parseXml(text, fileName);
    return { score, rec: this.recordFor(score, hashText(text), fileName, "musicxml", text), text };
  }

  /** Converted PDFs often carry no title; the file name is better than "Untitled". */
  private parseXml(text: string, fileName: string): Score {
    const score = parseMusicXML(text);
    if (score.title === UNTITLED) score.title = titleFromFileName(fileName);
    return score;
  }

  /* ---------- PDF import (beta) ---------- */

  private conv: { file: File; abort: AbortController; started: number; timer: number } | null = null;
  private lastPdf: File | null = null;

  private bindPdf(): void {
    const dialog = $<HTMLDialogElement>("pdfDialog");
    $("pdfBtn").addEventListener("click", () => dialog.showModal());
    if (!converterAvailable()) return;
    $("cvCancel").addEventListener("click", () => this.cancelConvert());
    $("cvDemo").addEventListener("click", () => void this.openDemo("fur-elise.musicxml"));
    $("cvRetry").addEventListener("click", () => {
      if (this.lastPdf) void this.convert(this.lastPdf);
    });
    $("cvManual").addEventListener("click", () => {
      dialog.querySelector("details")?.setAttribute("open", "");
      dialog.showModal();
    });
    $("cvBack").addEventListener("click", () => this.leaveConvertView());
    $("convertPill").addEventListener("click", () => this.setState("converting"));
  }

  /** Converts a PDF in the background; the song opens by itself if you are still waiting for it. */
  private async convert(file: File): Promise<void> {
    this.conv?.abort.abort(); // a new PDF replaces the one in progress
    this.unlockAudio();
    this.pausePlayback();
    const job = { file, abort: new AbortController(), started: Date.now(), timer: 0 };
    this.conv = job;
    this.lastPdf = file;
    const name = titleFromFileName(file.name);
    $("cvTitle").textContent = S.cvTitle;
    $("cvFile").textContent = file.name;
    $("cvRunning").hidden = false;
    $("cvFailed").hidden = true;
    document.querySelector(".cv-card")!.classList.remove("failed");
    $("cvStage").textContent = S.pdfStage.uploading;
    this.setState("converting");
    const tick = () => {
      const t = S.clock((Date.now() - job.started) / 1000);
      $("cvTime").textContent = t;
      $("pillText").textContent = S.pill(name, t);
    };
    tick();
    job.timer = window.setInterval(tick, 1000);
    let res: ConvertResult;
    try {
      res = await convertPdf(file, job.abort.signal, (stage, ahead) => {
        $("cvStage").textContent = stage === "queued" ? S.pdfQueued(ahead ?? 0) : S.pdfStage[stage];
      });
    } catch (e) {
      if (this.conv === job && !job.abort.signal.aborted) {
        this.finishConvert(job);
        this.convertFailed(
          file,
          e instanceof ConvertError ? e.message : S.loadFailed + " " + ((e as Error).message || ""),
        );
      }
      return;
    } finally {
      // Also when a newer PDF replaced this one.
      clearInterval(job.timer);
    }
    if (this.conv !== job) return;
    const waiting = this.state() === "converting";
    this.finishConvert(job);
    const failed = (e: unknown) => S.loadFailed + " " + ((e as Error).message || "");
    try {
      const song = await this.readSong(res.data, file.name);
      if (waiting) this.useScore(song.score, song.rec, song.text);
      // Kept in your recent songs right away, so it is still there if you miss the toast.
      const saved = await saveSong(song.rec, waiting);
      void this.paintRecent();
      if (waiting) this.toast(saved ? S.convertDone(res.pages, res.movements) : S.notSaved);
      else
        this.toast(S.readyToast(song.rec.title), false, {
          label: S.open,
          run: () => this.openRecord(song.rec).catch((e) => this.toast(failed(e), true)),
        });
    } catch (e) {
      this.convertFailed(file, failed(e));
    }
  }

  /** Shows why a conversion failed: on the waiting screen, or as a toast if you went elsewhere. */
  private convertFailed(file: File, msg: string): void {
    $("cvTitle").textContent = S.cvErrorTitle;
    $("cvErrorText").textContent = msg;
    $("cvRunning").hidden = true;
    $("cvFailed").hidden = false;
    document.querySelector(".cv-card")!.classList.add("failed");
    if (this.state() !== "converting") {
      this.toast(msg, true, { label: S.cvRetry, run: () => void this.convert(file) });
    }
  }

  private finishConvert(job: NonNullable<App["conv"]>): void {
    clearInterval(job.timer);
    if (this.conv === job) this.conv = null;
    this.paintPill();
  }

  private cancelConvert(): void {
    const job = this.conv;
    if (!job) return;
    job.abort.abort();
    this.finishConvert(job);
    this.leaveConvertView();
  }

  private leaveConvertView(): void {
    this.setState(this.score ? "ready" : "empty");
    void this.paintRecent();
  }

  private paintPill(): void {
    $("convertPill").hidden = !this.conv || this.state() === "converting";
  }

  private state(): string {
    return document.querySelector(".app")!.getAttribute("data-state") ?? "empty";
  }

  private async openRecord(rec: SongRecord): Promise<void> {
    const score =
      rec.kind === "midi"
        ? parseMidi(rec.data as ArrayBuffer, rec.fileName)
        : this.parseXml(rec.data as string, rec.fileName);
    this.useScore(score, rec, rec.kind === "midi" ? "" : (rec.data as string));
    // Titles can improve when the parser does; keep the list in step.
    rec.title = score.title;
    rec.composer = score.composer;
    rec.openedAt = Date.now();
    await saveSong(rec);
  }

  private recordFor(
    score: Score,
    id: string,
    fileName: string,
    kind: SongRecord["kind"],
    data: string | ArrayBuffer,
  ): SongRecord {
    if (!score.notes.length) throw new Error(S.emptyScore);
    return {
      id,
      fileName,
      title: score.title,
      composer: score.composer,
      kind,
      data,
      bars: score.measures.length,
      openedAt: Date.now(),
    };
  }

  private useScore(score: Score, rec: SongRecord, text: string): void {
    if (!score.notes.length) throw new Error(S.emptyScore);
    this.transport.stop(false);
    this.score = score;
    this.song = rec;
    this.overrides = loadFingers(rec.id);
    computeFingering(score, this.overrides);
    this.preferFlats = score.fifths < 0;
    const [lo, hi] = rangeFor(score.lo, score.hi);
    this.keyboard.setRange(lo, hi);
    if (score.source === "musicxml") this.sheet.setSource(score, text);
    else this.sheet.setSource(score, "");

    const bpm = $<HTMLInputElement>("bpm");
    const target = score.tempo || 100;
    bpm.max = String(Math.min(BPM_MAX, Math.max(160, Math.ceil((target * 1.25) / 2) * 2)));
    const cur = this.settings.get().bpm;
    if (cur > +bpm.max) this.settings.set({ bpm: +bpm.max });
    bpm.value = String(this.settings.get().bpm);

    this.paintHeader();
    this.buildTimeline();
    $("sheetHint").hidden = this.settings.get().view !== "sheet" || score.source === "midi";
    const saved = loadRange(rec.id);
    const M = score.measures;
    if (saved && saved[0] >= 0 && saved[1] < M.length && saved[0] <= saved[1])
      this.setRange(saved[0], saved[1]);
    else {
      const first = score.sections[0] ?? [0, Math.min(M.length - 1, 7)];
      this.setRange(first[0], first[1]);
    }
    this.setState("ready");
    this.paintBpm();
  }

  private setState(state: "empty" | "ready" | "converting"): void {
    document.querySelector(".app")!.setAttribute("data-state", state);
    if (state === "ready") this.requestFrame();
    this.paintPill();
  }

  private paintHeader(): void {
    const sc = this.score!;
    const naming = this.settings.get().naming;
    $("songTitle").textContent = sc.title;
    const meta = [
      sc.composer,
      sc.source === "musicxml" ? keyName(sc.fifths, sc.mode, naming) : "MIDI",
      sc.timeLabel,
      sc.tempo ? "♩ = " + sc.tempo : "",
      S.bars(sc.measures.length),
    ].filter(Boolean);
    $("songMeta").textContent = meta.join(" · ");
    document.title = sc.title + " · " + S.appName;
  }

  private async paintRecent(): Promise<void> {
    const list = await recentSongs();
    const box = $("recent");
    box.hidden = !list.length;
    $("recentList").innerHTML = list
      .map(
        (r) =>
          `<li><button type="button" class="recent-item" data-id="${esc(r.id)}">${ICON.file}<span class="ri-title">${esc(r.title)}</span><span class="ri-meta">${esc(r.composer || r.fileName)} · ${S.bars(r.bars)}</span></button>` +
          `<button type="button" class="icon-btn small" data-remove="${esc(r.id)}" aria-label="${S.removeRecent}">${ICON.trash}</button></li>`,
      )
      .join("");
  }

  /* ---------- bars and sections ---------- */

  private buildTimeline(): void {
    const M = this.score!.measures;
    const bars = $("bars");
    bars.innerHTML = "";
    M.forEach((m, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bar k-" + m.kind;
      b.textContent = m.label;
      b.title = S.barTitle(m.label, S.kind[m.kind]);
      b.addEventListener("click", () => this.pickBar(i));
      bars.appendChild(b);
    });
    const secs = $("sections");
    secs.innerHTML = "";
    const list: [string, number, number][] =
      this.score!.sections.length > 1
        ? this.score!.sections.map((s, i) => [S.part(i + 1, M[s[0]].label, M[s[1]].label), s[0], s[1]])
        : [];
    list.push([S.wholeSong, 0, M.length - 1]);
    for (const [label, a, b] of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "section";
      btn.textContent = label;
      btn.dataset.a = String(a);
      btn.dataset.b = String(b);
      btn.addEventListener("click", () => this.setRange(a, b));
      secs.appendChild(btn);
    }
  }

  private pickBar(i: number): void {
    if (this.anchor == null) {
      this.setRange(i, i);
      this.anchor = i;
      this.paintTimeline();
    } else this.setRange(Math.min(this.anchor, i), Math.max(this.anchor, i));
  }

  private setRange(a: number, b: number): void {
    const sc = this.score!;
    this.transport.stop(false);
    this.cursor = null;
    this.paintPlay();
    this.from = a;
    this.to = b;
    this.anchor = null;
    this.sheet.setSelection(a, b);
    this.falling.setSelection(sc, a, b);
    this.selNotes = sc.notes.filter((n) => n.m >= a && n.m <= b);
    const strikes = strikesIn(sc, a, b);
    this.attacks = [0, 1].map((h) => strikes.filter((n) => n.staff === h && !n.grace)) as [Note[], Note[]];
    this.onPick(null);
    this.paintTimeline();
    saveRange(this.song!.id, [a, b]);
    if (this.settings.get().view === "sheet") void this.showSheet();
    this.kbSig = "";
    this.requestFrame();
  }

  private paintTimeline(): void {
    const bars = $("bars").children;
    for (let i = 0; i < bars.length; i++) {
      const on = i >= this.from && i <= this.to;
      bars[i].classList.toggle("sel", on);
      bars[i].classList.toggle("anchor", this.anchor === i);
      bars[i].setAttribute("aria-pressed", String(on));
    }
    for (const b of $("sections").children) {
      const el = b as HTMLElement;
      el.classList.toggle("on", +el.dataset.a! === this.from && +el.dataset.b! === this.to);
    }
    const M = this.score!.measures;
    $("barHint").textContent = this.anchor != null ? S.barAnchor(M[this.anchor].label) : S.barHint;
    // keep the selection in view
    const first = bars[this.from] as HTMLElement | undefined;
    const wrap = first?.parentElement?.parentElement;
    if (first && wrap) {
      const l = first.offsetLeft - 8;
      if (l < wrap.scrollLeft || l > wrap.scrollLeft + wrap.clientWidth - 40)
        wrap.scrollTo({ left: l, behavior: "smooth" });
    }
  }

  private paintNowBar(mi: number): void {
    if (mi === this.nowBar) return;
    const bars = $("bars").children;
    bars[this.nowBar]?.classList.remove("now");
    if (mi >= 0) bars[mi]?.classList.add("now");
    this.nowBar = mi;
  }

  /** The selected bar that `absQ` falls in. */
  private barAt(absQ: number): number {
    const M = this.score!.measures;
    let mi = this.from;
    while (mi < this.to && M[mi + 1].startQ <= absQ + EPS) mi++;
    return mi;
  }

  /* ---------- playback ---------- */

  private togglePlay(): void {
    if (!this.score) return;
    this.unlockAudio();
    if (this.transport.running) {
      this.pausePlayback();
      this.requestFrame();
      return;
    }
    const st = this.settings.get();
    this.onPick(null);
    this.syncTransport();
    this.transport.start(this.score, this.from, this.to, {
      bpm: st.bpm,
      countIn: st.countIn,
      at: this.cursor ?? 0,
    });
    this.paintPlay();
    this.requestFrame();
  }

  /** Stops playing but keeps the place, to go on from there. */
  private pausePlayback(): void {
    if (this.transport.running) this.cursor = this.transport.pause() || null;
    this.paintPlay();
  }

  /** Back to the start of the selected bars; keeps playing if it was. */
  private restart(): void {
    const playing = this.transport.running;
    this.transport.stop(false);
    this.cursor = null;
    if (playing) this.togglePlay();
    else {
      this.paintPlay();
      this.requestFrame();
    }
  }

  private syncTransport(): void {
    const st = this.settings.get();
    this.transport.loop = st.loop;
    this.transport.hearing = { right: st.hearRight, left: st.hearLeft, click: st.click };
  }

  private paintPlay(): void {
    const b = $("playBtn");
    const on = this.transport.running;
    b.innerHTML = on ? ICON.pause : ICON.play;
    b.classList.toggle("playing", on);
    b.setAttribute("aria-label", on ? S.pause : S.play);
    $<HTMLButtonElement>("restartBtn").disabled = !on && this.cursor == null;
    if (!on) $("countBadge").hidden = true;
  }

  private paintBpm(): void {
    const st = this.settings.get();
    const target = this.score?.tempo || 0;
    let txt = st.bpm + " " + S.bpm;
    if (target) txt += " · " + S.ofTarget(Math.round((st.bpm / target) * 100));
    const out = $("bpmOut");
    out.textContent = txt;
    out.title = target ? S.tempoTitle(target) : "";
    const input = $<HTMLInputElement>("bpm");
    const pct = ((st.bpm - +input.min) / (+input.max - +input.min)) * 100;
    input.style.setProperty("--fill", pct + "%");
  }

  /* ---------- drawing ---------- */

  private requestFrame(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    this.raf = 0;
    const sc = this.score;
    if (!sc) return;
    const st = this.settings.get();
    const playing = this.transport.running;
    const pos = playing ? this.transport.position() : null;
    const spq = 60 / st.bpm;
    const selStart = sc.measures[this.from].startQ;
    // Stopped: the place you paused at, or the first notes just above the keys.
    const raw = pos ? pos.raw : (this.cursor ?? -PREROLL_SECONDS / spq);
    const running = pos ? pos.raw >= 0 : this.cursor != null && this.cursor >= 0;
    const absQ = running ? (pos ? pos.absQ : selStart + this.cursor!) : selStart - 1;
    const active = running ? soundingAt(this.selNotes, absQ) : [];
    // While counting in after a pause, the notes wait without lighting up.
    const sounding = playing && !pos?.countBeat;

    if (st.view === "falling") {
      this.falling.render(
        { raw, spq, playing: sounding, loop: st.loop },
        {
          colors: this.colors,
          heard: [st.hearRight, st.hearLeft],
          effects: st.effects,
          fingers: st.fingering,
          names: st.noteNames,
          label: (n) => {
            const sp = soundingSpelling(n);
            return pitchName(sp.step, sp.alter, st.naming);
          },
        },
      );
    }

    // keyboard
    const upcoming = new Map<number, KeyMark>();
    for (const h of [0, 1] as Hand[]) {
      const list = this.attacks[h];
      let i = list.findIndex((n) => n.q > absQ + EPS);
      if (i < 0 && st.loop && running) i = 0;
      if (i < 0) continue;
      const q = list[i].q;
      for (let j = i; j < list.length && Math.abs(list[j].q - q) < EPS; j++) {
        upcoming.set(list[j].sound, this.mark(list[j], st));
      }
    }
    const activeMap = new Map<number, KeyMark>();
    for (const n of active) activeMap.set(n.sound, this.mark(n, st));
    const picked = this.sheet.picked;
    const ghost = new Map<number, RGB>();
    if (st.view === "sheet") {
      for (const n of this.selNotes)
        if (!ghost.has(n.sound) || n.staff === 0) ghost.set(n.sound, this.colors[n.staff]);
    }
    // Fingers and hands too: a key struck again with another finger needs a new badge.
    const marks = (m: Map<number, KeyMark>) =>
      [...m].map(([k, v]) => k + ":" + v.hand + ":" + v.finger + ":" + v.name).join(",");
    const sig = marks(activeMap) + "|" + marks(upcoming) + "|" + (picked?.id ?? "") + "|" + ghost.size;
    if (sig !== this.kbSig) {
      this.kbSig = sig;
      this.keyboard.draw({
        active: activeMap,
        upcoming,
        ghost,
        picked: picked ? picked.sound : null,
        showNames: st.noteNames,
        showFingers: st.fingering,
        label: (m) => {
          const sp = spellMidi(m, this.preferFlats);
          return m % 12 === 0 ? fullName(sp, st.naming) : pitchName(sp.step, sp.alter, st.naming);
        },
      });
    }

    if (st.view === "sheet") {
      const s2 = active.map((n) => n.id).join(",");
      if (s2 !== this.sheetSig) {
        this.sheetSig = s2;
        this.sheet.highlight(active);
      }
    }

    // count-in and current bar
    const badge = $("countBadge");
    if (pos && pos.countBeat) {
      badge.hidden = false;
      badge.textContent = String(pos.countBeat);
    } else badge.hidden = true;
    this.paintNowBar(!running ? -1 : pos ? pos.measure : this.barAt(absQ));

    if (playing || (st.view === "falling" && this.falling.animating)) this.requestFrame();
  };

  private mark(n: Note, st: Settings): KeyMark {
    const sp = soundingSpelling(n);
    return {
      hand: n.staff,
      color: this.colors[n.staff],
      finger: n.finger,
      name: pitchName(sp.step, sp.alter, st.naming),
    };
  }

  /* ---------- sheet picking ---------- */

  private async showSheet(): Promise<void> {
    await this.sheet.show();
    this.sheetSig = "";
    this.applyOverlay();
  }

  private applyOverlay(): void {
    const st = this.settings.get();
    this.sheet.setOverlay({
      fingers: st.fingering,
      names: st.noteNames,
      label: (n) => fullName({ step: n.step, alter: n.alter, octave: n.octave }, st.naming),
    });
  }

  private onPick(n: Note | null): void {
    const bar = $("pickBar");
    if (this.sheet.picked !== n) this.sheet.picked = n;
    if (!n) {
      bar.hidden = true;
      this.kbSig = "";
      this.requestFrame();
      return;
    }
    this.unlockAudio();
    playNote(n.sound, 0, 0.9, 0.7);
    const st = this.settings.get();
    const head = tieHead(n);
    const src = head.fingerSrc ? S.fingerSource[head.fingerSrc] : "";
    bar.innerHTML =
      `<strong>${esc(fullName(soundingSpelling(n), st.naming))}</strong>` +
      `<span>${n.staff === 0 ? S.rightHandName : S.leftHandName} · bar ${esc(this.score!.measures[n.m].label)}</span>` +
      `<span class="pb-finger" style="--c:${n.staff === 0 ? "var(--rh)" : "var(--lh)"}">${S.finger(head.finger)}${src ? ` <em>${src}</em>` : ""}</span>` +
      `<span class="pb-hint">${S.pickHint}</span>`;
    bar.hidden = false;
    this.kbSig = "";
    this.requestFrame();
  }

  private setFinger(f: number): void {
    const n = this.sheet.picked;
    if (!n || !this.score || !this.song) return;
    const head = tieHead(n);
    if (f >= 1 && f <= 5) this.overrides[head.id] = f;
    else delete this.overrides[head.id];
    saveFingers(this.song.id, this.overrides);
    computeFingering(this.score, this.overrides);
    this.applyOverlay();
    this.onPick(n);
  }

  /* ---------- settings ---------- */

  private applySettings(s: Settings, changed: (keyof Settings)[]): void {
    const has = (...k: (keyof Settings)[]) => k.some((x) => changed.includes(x));
    if (has("rightColor", "leftColor")) {
      this.colors = [hexToRgb(s.rightColor), hexToRgb(s.leftColor)];
      const root = document.documentElement.style;
      root.setProperty("--rh", s.rightColor);
      root.setProperty("--lh", s.leftColor);
      $<HTMLInputElement>("rightColor").value = s.rightColor;
      $<HTMLInputElement>("leftColor").value = s.leftColor;
    }
    if (has("palette")) {
      for (const b of $("swatches").children) {
        const el = b as HTMLElement;
        el.setAttribute("aria-checked", String(el.dataset.palette === s.palette));
      }
    }
    for (const [id, key] of TOGGLES) {
      if (!has(key)) continue;
      const el = $(id);
      el.setAttribute("aria-pressed", String(!!s[key]));
    }
    if (has("view")) {
      for (const seg of [$("viewSeg"), $("viewSeg2")]) {
        for (const b of seg.children) {
          const el = b as HTMLElement;
          el.setAttribute("aria-checked", String(el.dataset.view === s.view));
        }
      }
      this.falling.el.hidden = s.view !== "falling";
      this.sheet.el.hidden = s.view !== "sheet";
      $("sheetHint").hidden = s.view !== "sheet" || this.score?.source === "midi";
      if (s.view !== "sheet") this.onPick(null);
      document.querySelector(".app")!.setAttribute("data-view", s.view);
      if (s.view === "sheet" && this.score) void this.showSheet();
    }
    if (has("naming")) {
      for (const b of $("namingSeg").children) {
        const el = b as HTMLElement;
        el.setAttribute("aria-checked", String(el.dataset.naming === s.naming));
      }
      if (this.score) this.paintHeader();
    }
    if (has("effects")) $<HTMLInputElement>("effectsOn").checked = s.effects;
    if (has("fingering")) this.keyboard.setStrip(s.fingering);
    if (has("noteNames", "fingering", "naming") && s.view === "sheet") this.applyOverlay();
    if (has("loop", "hearRight", "hearLeft", "click")) this.syncTransport();
    if (has("bpm")) {
      $<HTMLInputElement>("bpm").value = String(s.bpm);
      this.paintBpm();
    }
    this.kbSig = "";
    this.requestFrame();
  }

  /* ---------- wiring ---------- */

  private bindControls(): void {
    $("playBtn").addEventListener("click", () => this.togglePlay());
    $("restartBtn").addEventListener("click", () => this.restart());
    const bpm = $<HTMLInputElement>("bpm");
    bpm.addEventListener("input", () => {
      const v = +bpm.value;
      this.transport.setTempo(v);
      this.settings.set({ bpm: v });
    });
    for (const [id, key] of TOGGLES) {
      $(id).addEventListener("click", () => this.settings.set({ [key]: !this.settings.get()[key] }));
    }
    for (const seg of [$("viewSeg"), $("viewSeg2")]) {
      seg.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
        if (b) this.settings.set({ view: b.dataset.view as Settings["view"] });
      });
    }
  }

  private bindSettingsPanel(): void {
    const panel = $("settingsPanel");
    const btn = $("settingsBtn");
    const setOpen = (open: boolean) => {
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (open) panel.querySelector<HTMLElement>("button")?.focus();
    };
    btn.addEventListener("click", () => setOpen(!!panel.hidden));
    $("settingsClose").addEventListener("click", () => {
      setOpen(false);
      btn.focus();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!panel.hidden && !panel.contains(e.target as Node) && !btn.contains(e.target as Node))
        setOpen(false);
    });
    $("namingSeg").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-naming]");
      if (b) this.settings.set({ naming: b.dataset.naming as Settings["naming"] });
    });
    $("swatches").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-palette]");
      const p = PALETTES.find((x) => x.id === b?.dataset.palette);
      if (p) this.settings.set({ palette: p.id, rightColor: p.right, leftColor: p.left });
    });
    $<HTMLInputElement>("rightColor").addEventListener("input", (e) =>
      this.settings.set({ palette: "custom", rightColor: (e.target as HTMLInputElement).value }),
    );
    $<HTMLInputElement>("leftColor").addEventListener("input", (e) =>
      this.settings.set({ palette: "custom", leftColor: (e.target as HTMLInputElement).value }),
    );
    $<HTMLInputElement>("effectsOn").addEventListener("change", (e) =>
      this.settings.set({ effects: (e.target as HTMLInputElement).checked }),
    );
  }

  private bindFiles(): void {
    const input = $<HTMLInputElement>("fileIn");
    $("openBtn").addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) void this.openFile(f);
      input.value = "";
    });
    document.querySelectorAll<HTMLElement>("[data-demo]").forEach((b) =>
      b.addEventListener("click", () => {
        this.unlockAudio();
        void this.openDemo(b.dataset.demo!);
      }),
    );
    $("recentList").addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      const rm = t.closest<HTMLElement>("[data-remove]");
      if (rm) {
        await removeSong(rm.dataset.remove!);
        void this.paintRecent();
        return;
      }
      const item = t.closest<HTMLElement>("[data-id]");
      if (!item) return;
      this.unlockAudio();
      const rec = await getSong(item.dataset.id!);
      if (!rec) return;
      try {
        await this.openRecord(rec);
      } catch (err) {
        this.toast(S.loadFailed + " " + ((err as Error).message || ""), true);
      }
    });
    let depth = 0;
    const app = () => document.querySelector(".app")!;
    window.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      depth++;
      app().classList.add("dragging");
    });
    window.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) app().classList.remove("dragging");
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      depth = 0;
      app().classList.remove("dragging");
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        this.unlockAudio();
        void this.openFile(f);
      }
    });
    // Brand link goes back to the start screen.
    document.querySelector(".brand")!.addEventListener("click", (e) => {
      e.preventDefault();
      this.pausePlayback();
      void this.paintRecent();
      // Home shows the conversion while one runs, the start screen otherwise.
      this.setState(this.conv ? "converting" : "empty");
    });
  }

  private bindKeys(): void {
    document.addEventListener("pointerdown", () => this.unlockAudio(), { once: true });
    // Tab moves the focus by keyboard; a click puts it on whatever was clicked.
    let tabbing = false;
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Tab") tabbing = true;
      },
      true,
    );
    document.addEventListener("pointerdown", () => (tabbing = false), true);
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      const tag = el?.tagName.toLowerCase() ?? "";
      // The tempo slider keeps the focus after a drag, but has no use for Space.
      const slider = tag === "input" && (el as HTMLInputElement).type === "range";
      if ((tag === "input" && !(slider && e.key === " ")) || tag === "textarea" || tag === "select") return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        if (!$("settingsPanel").hidden) {
          $("settingsPanel").hidden = true;
          $("settingsBtn").setAttribute("aria-expanded", "false");
          return;
        }
        if (this.sheet.picked) this.sheet.pick(null);
        return;
      }
      if (!this.score || document.querySelector(".app")!.getAttribute("data-state") !== "ready") return;
      if (e.key === " ") {
        // A clicked button keeps the focus, yet Space should still play; only when you tabbed
        // to a button does Space press it.
        if ((tag === "button" || tag === "a") && tabbing) return;
        e.preventDefault();
        this.togglePlay();
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        this.restart();
        return;
      }
      if (this.sheet.picked) {
        if (/^[0-5]$/.test(e.key)) {
          e.preventDefault();
          this.setFinger(+e.key);
        } else if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          this.setFinger(0);
        } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          this.sheet.movePick(e.key === "ArrowRight" ? 1 : -1);
        }
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const input = $<HTMLInputElement>("bpm");
        const v = Math.max(
          +input.min,
          Math.min(+input.max, this.settings.get().bpm + (e.key === "ArrowUp" ? 2 : -2)),
        );
        this.transport.setTempo(v);
        this.settings.set({ bpm: v });
      }
    });
  }

  private toast(msg: string, error = false, action?: { label: string; run: () => void }): void {
    const t = $("toast");
    $("toastText").textContent = msg;
    const btn = $<HTMLButtonElement>("toastAction");
    btn.hidden = !action;
    btn.onclick = action
      ? () => {
          t.hidden = true;
          action.run();
        }
      : null;
    if (action) btn.textContent = action.label;
    t.classList.toggle("error", error);
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), action ? 20000 : error ? 6000 : 4500);
  }
}
