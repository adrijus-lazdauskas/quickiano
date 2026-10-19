/**
 * Writes the public domain demo pieces as MusicXML into public/demos/.
 * Run with: node scripts/build-demos.ts
 *
 * Tokens: "E5:2" = E5 for 2 sixteenths, "A4+C5:4" = chord, "r:3" = rest,
 * "C5:4~" = tie into the next note, "E4:4@3" = written fingering 3,
 * "g:C#5" = grace note before the next note.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Bar {
  rh: string[];
  lh: string[];
  pickup?: boolean;
  bar?: "light-light" | "light-heavy";
}

interface Piece {
  file: string;
  title: string;
  composer: string;
  fifths: number;
  mode: "major" | "minor";
  beats: number;
  beatType: number;
  tempo: number;
  /** Beam group length in sixteenths. */
  beamGroup: number;
  bars: Bar[];
}

const TYPE: Record<number, [string, number]> = {
  1: ["16th", 0],
  2: ["eighth", 0],
  3: ["eighth", 1],
  4: ["quarter", 0],
  6: ["quarter", 1],
  8: ["half", 0],
  12: ["half", 1],
  16: ["whole", 0],
};

interface Item {
  grace: boolean;
  pitches: string[];
  dur: number;
  tie: boolean;
  fing: number | null;
}

function voice(tokens: string[], staff: number, vno: number, beamGroup: number, pending: Set<string>) {
  const items: Item[] = tokens.map((tok) => {
    if (tok.startsWith("g:")) return { grace: true, pitches: [tok.slice(2)], dur: 0, tie: false, fing: null };
    const [head, tail] = tok.split(":");
    const m = tail.match(/^(\d+)(~?)(?:@(\d))?$/);
    if (!m) throw new Error("bad token " + tok);
    return {
      grace: false,
      pitches: head === "r" ? [] : head.split("+"),
      dur: +m[1],
      tie: !!m[2],
      fing: m[3] ? +m[3] : null,
    };
  });
  const beams: ([string, string | null] | null)[] = items.map(() => null);
  let pos = 0;
  let group: number[] = [];
  let groupIdx = -1;
  const flush = () => {
    if (group.length > 1) {
      group.forEach((gi, j) => {
        const it = items[gi];
        const last = j === group.length - 1;
        const b1 = j === 0 ? "begin" : last ? "end" : "continue";
        let b2: string | null = null;
        if (it.dur === 1) {
          const prev = j > 0 && items[group[j - 1]].dur === 1;
          const next = !last && items[group[j + 1]].dur === 1;
          b2 =
            prev && next
              ? "continue"
              : prev
                ? "end"
                : next
                  ? "begin"
                  : last
                    ? "backward hook"
                    : "forward hook";
        }
        beams[gi] = [b1, b2];
      });
    }
    group = [];
  };
  items.forEach((it, i) => {
    if (it.grace) return;
    const g = Math.floor(pos / beamGroup);
    const beamable = it.pitches.length > 0 && it.dur <= 3;
    if (!beamable || g !== groupIdx) {
      flush();
      groupIdx = g;
    }
    if (beamable) group.push(i);
    pos += it.dur;
  });
  flush();

  let xml = "";
  items.forEach((it, i) => {
    if (!it.pitches.length) {
      const [type, dot] = TYPE[it.dur];
      xml += `<note><rest/><duration>${it.dur}</duration><voice>${vno}</voice><type>${type}</type>${dot ? "<dot/>" : ""}<staff>${staff}</staff></note>`;
      return;
    }
    it.pitches.forEach((p, j) => {
      const mm = p.match(/^([A-G])(#|b)?(\d)$/);
      if (!mm) throw new Error("bad pitch " + p);
      const alter = mm[2] === "#" ? 1 : mm[2] === "b" ? -1 : 0;
      const key = staff + p;
      const stop = !it.grace && pending.has(key);
      if (stop) pending.delete(key);
      if (it.tie) pending.add(key);
      let n = "<note>";
      if (it.grace) n += '<grace slash="yes"/>';
      if (j > 0) n += "<chord/>";
      n += `<pitch><step>${mm[1]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${mm[3]}</octave></pitch>`;
      if (!it.grace) n += `<duration>${it.dur}</duration>`;
      if (stop) n += '<tie type="stop"/>';
      if (it.tie) n += '<tie type="start"/>';
      n += `<voice>${vno}</voice><type>${it.grace ? "eighth" : TYPE[it.dur][0]}</type>`;
      if (!it.grace && TYPE[it.dur][1]) n += "<dot/>";
      if (alter) n += `<accidental>${alter > 0 ? "sharp" : "flat"}</accidental>`;
      n += `<staff>${staff}</staff>`;
      const bm = beams[i];
      if (j === 0 && bm) {
        n += `<beam number="1">${bm[0]}</beam>`;
        if (bm[1]) n += `<beam number="2">${bm[1]}</beam>`;
      }
      const nots: string[] = [];
      if (stop) nots.push('<tied type="stop"/>');
      if (it.tie) nots.push('<tied type="start"/>');
      if (it.fing && j === 0) nots.push(`<technical><fingering>${it.fing}</fingering></technical>`);
      if (nots.length) n += `<notations>${nots.join("")}</notations>`;
      xml += n + "</note>";
    });
  });
  return { xml, len: pos };
}

function build(p: Piece): string {
  const pending = new Set<string>();
  let body = "";
  p.bars.forEach((b, i) => {
    const number = p.bars[0].pickup ? i : i + 1;
    let mx = `<measure number="${number}"${b.pickup ? ' implicit="yes"' : ""}>`;
    if (i === 0) {
      mx +=
        `<attributes><divisions>4</divisions><key><fifths>${p.fifths}</fifths><mode>${p.mode}</mode></key>` +
        `<time><beats>${p.beats}</beats><beat-type>${p.beatType}</beat-type></time><staves>2</staves>` +
        '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' +
        `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${p.tempo}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${p.tempo}"/></direction>`;
    }
    const r = voice(b.rh, 1, 1, p.beamGroup, pending);
    mx += r.xml + `<backup><duration>${r.len}</duration></backup>`;
    mx += voice(b.lh, 2, 5, p.beamGroup, pending).xml;
    if (b.bar) mx += `<barline location="right"><bar-style>${b.bar}</bar-style></barline>`;
    body += mx + "</measure>";
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
    `<score-partwise version="3.1"><work><work-title>${p.title}</work-title></work>` +
    `<identification><creator type="composer">${p.composer}</creator><rights>Public domain</rights></identification>` +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    `<part id="P1">${body}</part></score-partwise>\n`
  );
}

const A_MIN_ARP = ["A2:1", "E3:1", "A3:1", "r:3"];
const E_ARP = ["E2:1", "E3:1", "G#3:1", "r:3"];
const TURN = ["E5:1", "D#5:1", "E5:1", "B4:1", "D5:1", "C5:1"];

const furElise: Piece = {
  file: "fur-elise.musicxml",
  title: "Für Elise (opening)",
  composer: "Ludwig van Beethoven",
  fifths: 0,
  mode: "minor",
  beats: 3,
  beatType: 8,
  tempo: 66,
  beamGroup: 6,
  bars: [
    { rh: ["E5:1@5", "D#5:1@4"], lh: ["r:2"], pickup: true },
    { rh: TURN, lh: ["r:6"] },
    { rh: ["A4:2", "r:1", "C4:1", "E4:1", "A4:1"], lh: A_MIN_ARP },
    { rh: ["B4:2", "r:1", "E4:1", "G#4:1", "B4:1"], lh: E_ARP },
    { rh: ["C5:2", "r:1", "E4:1", "E5:1", "D#5:1"], lh: A_MIN_ARP },
    { rh: TURN, lh: ["r:6"] },
    { rh: ["A4:2", "r:1", "C4:1", "E4:1", "A4:1"], lh: A_MIN_ARP },
    { rh: ["B4:2", "r:1", "E4:1", "C5:1", "B4:1"], lh: E_ARP },
    { rh: ["A4:6"], lh: A_MIN_ARP, bar: "light-heavy" },
  ],
};

const odeToJoy: Piece = {
  file: "ode-to-joy.musicxml",
  title: "Ode to Joy (easy)",
  composer: "Ludwig van Beethoven",
  fifths: 0,
  mode: "major",
  beats: 4,
  beatType: 4,
  tempo: 100,
  beamGroup: 4,
  bars: [
    { rh: ["E4:4@3", "E4:4", "F4:4", "G4:4"], lh: ["C3:16@5"] },
    { rh: ["G4:4", "F4:4", "E4:4", "D4:4"], lh: ["G2:16"] },
    { rh: ["C4:4", "C4:4", "D4:4", "E4:4"], lh: ["C3:16"] },
    { rh: ["E4:6", "D4:2", "D4:8"], lh: ["G2:16"], bar: "light-light" },
    { rh: ["E4:4", "E4:4", "F4:4", "G4:4"], lh: ["C3:16"] },
    { rh: ["G4:4", "F4:4", "E4:4", "D4:4"], lh: ["G2:16"] },
    { rh: ["C4:4", "C4:4", "D4:4", "E4:4"], lh: ["C3:16"] },
    { rh: ["D4:6", "C4:2", "C4:8"], lh: ["G2:8", "C3:8"], bar: "light-heavy" },
  ],
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demos");
mkdirSync(outDir, { recursive: true });
for (const piece of [furElise, odeToJoy]) {
  writeFileSync(join(outDir, piece.file), build(piece));
  console.log("wrote", piece.file);
}
