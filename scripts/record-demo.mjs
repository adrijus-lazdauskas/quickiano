/**
 * Records the README media from a running dev server with the installed Chrome:
 * docs/demo.gif (falling notes), docs/sheet.png and docs/start.png.
 *
 *   npm run dev            # in one terminal
 *   npm run record         # in another, needs ffmpeg
 *
 * Optional: BASE_URL=http://localhost:5173 npm run record
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = new URL("../docs/", import.meta.url).pathname;
const SIZE = { width: 1280, height: 720 };

const settings = {
  view: "falling",
  naming: "english",
  palette: "neon",
  rightColor: "#ff4fd8",
  leftColor: "#8b5cff",
  effects: true,
  noteNames: true,
  fingering: true,
  loop: true,
  countIn: false,
  hearRight: true,
  hearLeft: true,
  click: false,
  bpm: 66,
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function page() {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
  await context.addInitScript((s) => localStorage.setItem("quickiano:settings", JSON.stringify(s)), settings);
  const p = await context.newPage();
  await p.goto(BASE);
  return { p, context };
}

/** Captures frames with Chrome's screencast while `act` runs, then writes a GIF with ffmpeg. */
async function recordGif(p, context, out, act) {
  const dir = mkdtempSync(join(tmpdir(), "quickiano-frames-"));
  const cdp = await context.newCDPSession(p);
  const frames = [];
  cdp.on("Page.screencastFrame", (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp });
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  await act();
  await cdp.send("Page.stopScreencast");
  // concat list with the real time each frame was on screen
  let list = "";
  frames.forEach((f, i) => {
    const name = join(dir, `f${String(i).padStart(5, "0")}.jpg`);
    writeFileSync(name, Buffer.from(f.data, "base64"));
    const next = frames[i + 1]?.t ?? f.t + 1 / 30;
    list += `file '${name}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`;
  });
  writeFileSync(join(dir, "list.txt"), list);
  const filters = "fps=15,scale=960:-1:flags=lanczos";
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    join(dir, "list.txt"),
    "-vf",
    `${filters},split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
    out,
  ]);
  rmSync(dir, { recursive: true, force: true });
  return frames.length;
}

// Start screen
{
  const { p, context } = await page();
  await wait(600);
  await p.screenshot({ path: join(OUT, "start.png") });
  await context.close();
}

// Falling notes clip
{
  const { p, context } = await page();
  await p.getByRole("button", { name: "Für Elise" }).click();
  await wait(700);
  await p.locator("#playBtn").click();
  await wait(1200);
  const n = await recordGif(p, context, join(OUT, "demo.gif"), () => wait(9000));
  console.log("captured", n, "frames");
  await context.close();
}

// Sheet music with fingering
{
  const { p, context } = await page();
  await p.getByRole("button", { name: "Für Elise" }).click();
  await wait(500);
  await p.getByRole("radio", { name: "Sheet music" }).first().click();
  await wait(2500);
  await p.screenshot({ path: join(OUT, "sheet.png") });
  await context.close();
}

await browser.close();
console.log("wrote docs/start.png, docs/demo.gif, docs/sheet.png");
