import type { SongRecord } from "../src/app/library";

type Handler = (() => void) | null;

class Request<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
}

/**
 * Just enough IndexedDB for library.ts: one store, events in later tasks, writes kept only
 * when the transaction commits. `full` makes every write fail at commit, like a full disk.
 */
export function fakeIndexedDB(opts: { full?: boolean } = {}) {
  const rows = new Map<string, SongRecord>();
  let created = false;
  const later = (fn: () => void) => setTimeout(fn, 0);

  const db = {
    createObjectStore: () => {
      created = true;
      return { createIndex: () => {} };
    },
    transaction: (_store: string, mode: IDBTransactionMode) => {
      const tx = {
        oncomplete: null as Handler,
        onabort: null as Handler,
        onerror: null as Handler,
        error: null as DOMException | null,
      };
      const writes: (() => void)[] = [];
      const request = <T>(read: () => T) => {
        const req = new Request<T>();
        later(() => {
          req.result = read();
          req.onsuccess?.();
          later(() => {
            if (mode === "readwrite" && opts.full) {
              tx.error = new DOMException("The disk is full.", "QuotaExceededError");
              tx.onabort?.();
              return;
            }
            writes.forEach((w) => w());
            tx.oncomplete?.();
          });
        });
        return req;
      };
      const store = {
        put: (rec: SongRecord) => {
          const copy = structuredClone(rec);
          writes.push(() => rows.set(copy.id, copy));
          return request(() => rec.id);
        },
        get: (id: string) => request(() => rows.get(id)),
        getAll: () => request(() => [...rows.values()]),
        delete: (id: string) => {
          writes.push(() => rows.delete(id));
          return request(() => undefined);
        },
        index: () => ({
          getAllKeys: () =>
            request(() => [...rows.values()].sort((a, b) => a.openedAt - b.openedAt).map((r) => r.id)),
        }),
      };
      return Object.assign(tx, { objectStore: () => store });
    },
  };

  return {
    rows,
    indexedDB: {
      open: () => {
        const req = new Request<typeof db>();
        later(() => {
          req.result = db;
          if (!created) req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req;
      },
    },
  };
}
