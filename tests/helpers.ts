/** Wraps measures of a two-staff piano part into a complete MusicXML document. */
export function pianoXML(
  measures: string,
  opts: { title?: string; fifths?: number; time?: string } = {},
): string {
  const [beats, beatType] = (opts.time ?? "4/4").split("/");
  const attrs =
    "<attributes><divisions>4</divisions>" +
    `<key><fifths>${opts.fifths ?? 0}</fifths><mode>major</mode></key>` +
    `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves>` +
    '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>' +
    "</attributes>";
  const withAttrs = measures.replace(/(<measure[^>]*>)/, `$1${attrs}`);
  return (
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">' +
    `<work><work-title>${opts.title ?? "Test"}</work-title></work>` +
    '<identification><creator type="composer">Tester</creator></identification>' +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    `<part id="P1">${withAttrs}</part></score-partwise>`
  );
}

/** One note element. `pitch` like "C4", "F#5", "Bb3"; dur in divisions (4 = quarter). */
export function note(
  pitch: string,
  dur: number,
  staff: 1 | 2,
  extra: { chord?: boolean; tie?: "start" | "stop" | "both"; finger?: number; grace?: boolean } = {},
): string {
  const m = pitch.match(/^([A-G])(#|b)?(\d)$/);
  if (!m) throw new Error("bad pitch " + pitch);
  const alter = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const ties = extra.tie === "both" ? ["stop", "start"] : extra.tie ? [extra.tie] : ([] as string[]);
  let x = "<note>";
  if (extra.grace) x += '<grace slash="yes"/>';
  if (extra.chord) x += "<chord/>";
  x += `<pitch><step>${m[1]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${m[3]}</octave></pitch>`;
  if (!extra.grace) x += `<duration>${dur}</duration>`;
  for (const t of ties) x += `<tie type="${t}"/>`;
  x += `<voice>${staff === 1 ? 1 : 5}</voice><staff>${staff}</staff>`;
  const nots: string[] = ties.map((t) => `<tied type="${t}"/>`);
  if (extra.finger) nots.push(`<technical><fingering>${extra.finger}</fingering></technical>`);
  if (nots.length) x += `<notations>${nots.join("")}</notations>`;
  return x + "</note>";
}

export const rest = (dur: number, staff: 1 | 2) =>
  `<note><rest/><duration>${dur}</duration><voice>${staff === 1 ? 1 : 5}</voice><staff>${staff}</staff></note>`;

export const backup = (dur: number) => `<backup><duration>${dur}</duration></backup>`;

/** An 8va/8vb line mark: "down" starts 8va, "up" starts 8vb, then "stop" or "continue". */
export const octaveShift = (type: "down" | "up" | "stop" | "continue", staff: 1 | 2 = 1, size = 8) =>
  `<direction><direction-type><octave-shift type="${type}" size="${size}"/></direction-type><staff>${staff}</staff></direction>`;
