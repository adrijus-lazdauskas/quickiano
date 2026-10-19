import { type RGB, glowSprite } from "./color";

/*
 * Particles for key hits: sparks that fly up and fade, and soft smoke that
 * drifts and widens. A fixed pool avoids garbage while playing; everything is
 * drawn with additive blending from cached glow sprites.
 */

const MAX = 1400;

interface Particle {
  alive: boolean;
  smoke: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  sprite: HTMLCanvasElement;
}

export class Effects {
  private pool: Particle[] = [];
  private next = 0;
  private sprites = new Map<string, HTMLCanvasElement>();
  private count = 0;

  constructor() {
    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        alive: false,
        smoke: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        max: 1,
        size: 1,
        sprite: null as unknown as HTMLCanvasElement,
      });
    }
  }

  sprite(color: RGB): HTMLCanvasElement {
    const key = color.join(",");
    let s = this.sprites.get(key);
    if (!s) {
      s = glowSprite(color);
      this.sprites.set(key, s);
    }
    return s;
  }

  private spawn(): Particle {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % MAX;
    if (!p.alive) this.count++;
    p.alive = true;
    return p;
  }

  /** A burst of sparks where a key is hit. */
  burst(x: number, y: number, color: RGB, width: number): void {
    const sprite = this.sprite(color);
    const n = 14 + Math.round(width * 0.4);
    for (let i = 0; i < n; i++) {
      const p = this.spawn();
      p.smoke = false;
      p.x = x + (Math.random() - 0.5) * width;
      p.y = y;
      p.vx = (Math.random() - 0.5) * 90;
      p.vy = -(60 + Math.random() * 240);
      p.max = p.life = 0.45 + Math.random() * 0.8;
      p.size = 3 + Math.random() * 6;
      p.sprite = sprite;
    }
    for (let i = 0; i < 3; i++) this.puff(x, y, color, width);
  }

  /** Steady trickle while a key is held; `dt` in seconds. */
  emit(x: number, y: number, color: RGB, width: number, dt: number): void {
    const sprite = this.sprite(color);
    let n = dt * 40;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      const p = this.spawn();
      p.smoke = false;
      p.x = x + (Math.random() - 0.5) * width * 0.8;
      p.y = y;
      p.vx = (Math.random() - 0.5) * 40;
      p.vy = -(30 + Math.random() * 140);
      p.max = p.life = 0.35 + Math.random() * 0.7;
      p.size = 2 + Math.random() * 4;
      p.sprite = sprite;
    }
    if (Math.random() < dt * 9) this.puff(x, y, color, width);
  }

  private puff(x: number, y: number, color: RGB, width: number): void {
    const p = this.spawn();
    p.smoke = true;
    p.x = x + (Math.random() - 0.5) * width;
    p.y = y - Math.random() * 10;
    p.vx = (Math.random() - 0.5) * 22;
    p.vy = -(18 + Math.random() * 40);
    p.max = p.life = 1.2 + Math.random() * 1.4;
    p.size = 26 + Math.random() * 40;
    p.sprite = this.sprite(color);
  }

  get active(): boolean {
    return this.count > 0;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
    this.count = 0;
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.count--;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.smoke) {
        p.vy *= 1 - 0.5 * dt;
        p.size += 18 * dt;
      } else {
        p.vx *= 1 - 1.5 * dt;
        p.vy += 120 * dt; // sparks slow down and arc
      }
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    g.save();
    g.globalCompositeOperation = "lighter";
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.max;
      if (p.smoke) {
        g.globalAlpha = 0.16 * t * (1 - t) * 4;
      } else {
        g.globalAlpha = Math.min(1, t * 1.6);
      }
      const s = p.size * (p.smoke ? 1 : 0.6 + 0.4 * t);
      g.drawImage(p.sprite, p.x - s / 2, p.y - s / 2, s, s);
    }
    g.restore();
  }
}
