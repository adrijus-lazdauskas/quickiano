import { afterEach, describe, expect, it, vi } from "vitest";
import { ConvertError, convertPdf, wake } from "../src/app/converter";
import { titleFromFileName } from "../src/core/score";

const BASE = "https://converter.test";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fake converter: the job is queued once, runs once, then is done. */
function fakeConverter(finalStatus: "done" | "failed" = "done") {
  const polls: string[] = ["queued", "running", finalStatus];
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(method + " " + url.replace(BASE, ""));
    if (url === BASE + "/") return json({ status: "ok" });
    if (method === "POST") return json({ id: "j1", status: "queued", ahead: 1, pages: 3 }, 202);
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (url.endsWith("/result"))
      return new Response("MXL", { headers: { "X-Pages": "3", "X-Movements": "1" } });
    const status = polls.shift() ?? finalStatus;
    return json({ id: "j1", status, error: status === "failed" ? "No music could be read." : undefined });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("convertPdf", () => {
  it("uploads a job, follows it and returns the MusicXML", async () => {
    const calls = fakeConverter();
    const stages: string[] = [];
    const res = await convertPdf(
      new Blob(["%PDF"]),
      new AbortController().signal,
      (s, ahead) => stages.push(ahead != null ? `${s}:${ahead}` : s),
      BASE,
      1,
    );
    expect(new TextDecoder().decode(res.data)).toBe("MXL");
    expect(res.pages).toBe(3);
    expect(stages).toEqual(["uploading", "queued:1", "queued", "reading"]);
    expect(calls).toContain("GET /jobs/j1/result");
  });

  it("passes the converter's message on when a job fails", async () => {
    fakeConverter("failed");
    await expect(
      convertPdf(new Blob(["%PDF"]), new AbortController().signal, () => {}, BASE, 1),
    ).rejects.toThrow("No music could be read.");
  });

  it("passes upload errors on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === BASE + "/" ? json({ status: "ok" }) : json({ detail: "This PDF has 30 pages." }, 413),
      ),
    );
    await expect(
      convertPdf(new Blob(["%PDF"]), new AbortController().signal, () => {}, BASE, 1),
    ).rejects.toThrow("This PDF has 30 pages.");
  });

  it("cancels the job on the converter when aborted", async () => {
    const calls = fakeConverter();
    const abort = new AbortController();
    const run = convertPdf(
      new Blob(["%PDF"]),
      abort.signal,
      (s) => {
        if (s === "queued") abort.abort();
      },
      BASE,
      50,
    );
    await expect(run).rejects.toBeDefined();
    expect(calls).toContain("DELETE /jobs/j1");
  });
});

describe("wake", () => {
  it("explains when the converter can't be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const stages: string[] = [];
    const err = await wake(BASE, new AbortController().signal, (s) => stages.push(s), 30, 10).catch((e) => e);
    expect(err).toBeInstanceOf(ConvertError);
    expect(stages).toEqual(["waking"]);
  });
});

describe("titleFromFileName", () => {
  it("turns a file name into a readable title", () => {
    expect(titleFromFileName("La_Valse_dAmelie-original.pdf")).toBe("La Valse dAmelie original");
    expect(titleFromFileName("song.MXL")).toBe("song");
    expect(titleFromFileName(".pdf")).toBe("Untitled");
  });
});
