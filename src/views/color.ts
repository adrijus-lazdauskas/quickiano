export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes towards white (amount > 0) or black (amount < 0). */
export function shade([r, g, b]: RGB, amount: number): RGB {
  const t = amount < 0 ? 0 : 255;
  const a = Math.abs(amount);
  return [r + (t - r) * a, g + (t - g) * a, b + (t - b) * a].map(Math.round) as RGB;
}

export const rgba = ([r, g, b]: RGB, a = 1) => `rgba(${r},${g},${b},${a})`;

/** Perceived lightness 0..1, to pick dark or light text on a colour. */
export function luminance([r, g, b]: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Soft round glow sprite in one colour, drawn once and stretched where needed. */
export function glowSprite(color: RGB, size = 128): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, rgba(shade(color, 0.5), 1));
  grd.addColorStop(0.25, rgba(color, 0.55));
  grd.addColorStop(0.6, rgba(color, 0.16));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}
