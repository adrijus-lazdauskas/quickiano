import { S } from "../ui/strings";

/**
 * Client for the optional PDF converter (Audiveris on Modal, see server/).
 * The address comes from VITE_CONVERTER_URL at build time, or the default below;
 * set VITE_CONVERTER_URL to an empty string to hide PDF conversion (only the manual steps show).
 */
const DEFAULT_URL = "https://adrijus-lazdauskas--quickiano-converter.modal.run";

export const converterUrl = String(import.meta.env.VITE_CONVERTER_URL ?? DEFAULT_URL).replace(/\/+$/, "");

export const converterAvailable = (): boolean => converterUrl !== "";

export type ConvertStage = "waking" | "uploading" | "queued" | "reading";

export interface ConvertResult {
  data: ArrayBuffer;
  pages: number;
  movements: number;
}

interface JobInfo {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  pages?: number;
  ahead?: number;
  error?: string;
}

/** A failure with a message meant for the user. */
export class ConvertError extends Error {}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** fetch that turns network failures into a readable ConvertError, but lets aborts through. */
async function request(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { cache: "no-store", ...init, signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ConvertError(S.convertUnreachable);
  }
}

async function failure(res: Response): Promise<ConvertError> {
  let detail = "";
  try {
    detail = ((await res.json()) as { detail?: string }).detail ?? "";
  } catch {
    /* not JSON, e.g. a proxy error page */
  }
  return new ConvertError(detail || S.convertFailed(res.status));
}

async function ping(base: string, signal: AbortSignal, timeoutMs = 10_000): Promise<boolean> {
  // Gives up after timeoutMs or when `signal` aborts. Not AbortSignal.any: Safari has it only since 17.4.
  const ask = new AbortController();
  const stop = () => ask.abort(signal.reason);
  const timer = setTimeout(() => ask.abort(), timeoutMs);
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  try {
    const r = await fetch(base + "/", { cache: "no-store", signal: ask.signal });
    if (!r.ok) return false;
    return ((await r.json()) as { status?: string }).status === "ok";
  } catch (e) {
    if (signal.aborted) throw e;
    return false;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

/** The converter sleeps when nobody uses it; the first request wakes it (up to a minute or two). */
export async function wake(
  base: string,
  signal: AbortSignal,
  onStage: (s: ConvertStage) => void,
  waitMs = 150_000,
  pollMs = 4_000,
  pingMs = 10_000,
): Promise<void> {
  if (await ping(base, signal, pingMs)) return;
  onStage("waking");
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await sleep(pollMs, signal);
    if (await ping(base, signal, pingMs)) return;
  }
  throw new ConvertError(S.convertUnreachable);
}

/**
 * Uploads the PDF as a job, follows it until the converter is done and returns
 * the MusicXML (.mxl). Aborting cancels the job on the converter too.
 */
export async function convertPdf(
  file: Blob,
  signal: AbortSignal,
  onStage: (s: ConvertStage, ahead?: number) => void,
  base = converterUrl,
  pollMs = 2_000,
): Promise<ConvertResult> {
  await wake(base, signal, onStage);
  onStage("uploading");
  const form = new FormData();
  form.append("file", file, "score.pdf");
  const created = await request(base + "/jobs", { method: "POST", body: form }, signal);
  if (!created.ok) throw await failure(created);
  let job = (await created.json()) as JobInfo;
  try {
    let misses = 0;
    while (job.status === "queued" || job.status === "running") {
      onStage(job.status === "queued" ? "queued" : "reading", job.ahead);
      await sleep(pollMs, signal);
      try {
        const r = await request(`${base}/jobs/${job.id}`, {}, signal);
        if (!r.ok) throw await failure(r);
        job = (await r.json()) as JobInfo;
        misses = 0;
      } catch (e) {
        // A dropped poll on a shaky connection is no reason to give up a long conversion.
        if (signal.aborted || !(e instanceof ConvertError) || ++misses > 5) throw e;
      }
    }
    if (job.status !== "done") throw new ConvertError(job.error || S.convertFailed(500));
    const res = await request(`${base}/jobs/${job.id}/result`, {}, signal);
    if (!res.ok) throw await failure(res);
    return {
      data: await res.arrayBuffer(),
      pages: Number(res.headers.get("X-Pages")) || job.pages || 0,
      movements: Number(res.headers.get("X-Movements")) || 1,
    };
  } catch (e) {
    if (signal.aborted) {
      void fetch(`${base}/jobs/${job.id}`, { method: "DELETE", keepalive: true }).catch(() => {});
    }
    throw e;
  }
}
