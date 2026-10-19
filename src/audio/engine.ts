/** Shared AudioContext with a gentle compressor; `master` can be swapped to cut scheduled notes. */

let ctx: AudioContext | null = null;
let bus: DynamicsCompressorNode | null = null;
let master: GainNode | null = null;

type AudioContextCtor = typeof AudioContext;

export function getContext(): AudioContext | null {
  if (!ctx) {
    const AC: AudioContextCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: "interactive" });
    bus = ctx.createDynamicsCompressor();
    bus.threshold.value = -12;
    bus.ratio.value = 3;
    bus.attack.value = 0.004;
    bus.release.value = 0.2;
    bus.connect(ctx.destination);
    newMaster();
  }
  return ctx;
}

/** Call from a user gesture: browsers start the context suspended. */
export function resume(): AudioContext | null {
  const c = getContext();
  if (c && c.state === "suspended") void c.resume();
  return c;
}

function newMaster(): void {
  if (!ctx || !bus) return;
  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(bus);
}

export function output(): GainNode | null {
  getContext();
  return master;
}

/** Silences everything already scheduled ahead (the sequencer looks 300 ms into the future). */
export function silenceScheduled(): void {
  if (!ctx || !master) return;
  const old = master;
  old.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.015);
  setTimeout(() => {
    try {
      old.disconnect();
    } catch {
      /* already gone */
    }
  }, 400);
  newMaster();
}

/** Seconds of delay between scheduling and hearing, for drawing in sync. */
export function outputLatency(): number {
  if (!ctx) return 0;
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
}
