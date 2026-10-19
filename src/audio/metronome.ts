import { getContext, output } from "./engine";

export function click(when: number, accent: boolean): void {
  const c = getContext();
  const out = output();
  if (!c || !out) return;
  const t = Math.max(when, c.currentTime);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "square";
  o.frequency.value = accent ? 1400 : 900;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(accent ? 0.085 : 0.045, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + 0.06);
}
