/* global Response */

// A stand-in for the R2 bucket binding that behaves like the real one where the relay has been wrong before.
// Docs: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
//   · list() returns key + size only; httpMetadata / customMetadata come back only when named in `include`
//     (compatibility_date >= 2022-08-04). A fake that always returned them let a cleanup that never saw
//     expiresAt pass its tests while the real bucket grew to 13.7 GB.
//   · list() pages and delete([keys]) are both capped at 1000; a page may be shorter than `limit`.
//   · every binding call counts toward the Worker's per-invocation subrequest limit (maxOperations).
export const R2_BATCH_LIMIT = 1000;

export function createFakeR2({ pageCap = R2_BATCH_LIMIT, maxOperations = Infinity } = {}) {
  const values = new Map();
  const calls = { list: [], delete: [], put: 0, get: 0 };
  let operations = 0;

  function spend() {
    operations += 1;
    if (operations > maxOperations) throw new Error("Too many subrequests");
  }

  return {
    values,
    calls,
    get operations() { return operations; },
    /** Test seeding: customMetadata is stored exactly as put() would store it. */
    seed(key, { size = 1, expiresAt, customMetadata, contentType = "image/png" } = {}) {
      const meta = customMetadata ?? (expiresAt === undefined ? undefined : { expiresAt });
      values.set(key, { bytes: new Uint8Array(size), customMetadata: meta, httpMetadata: { contentType } });
    },
    async put(key, body, options = {}) {
      spend();
      calls.put += 1;
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      values.set(key, { bytes, customMetadata: options.customMetadata, httpMetadata: options.httpMetadata });
    },
    async get(key) {
      spend();
      calls.get += 1;
      const item = values.get(key);
      if (!item) return null;
      return {
        key,
        size: item.bytes.length,
        body: new Response(item.bytes).body,
        customMetadata: item.customMetadata ?? {},
        httpMetadata: item.httpMetadata ?? {},
        writeHttpMetadata(headers) { if (item.httpMetadata?.contentType) headers.set("Content-Type", item.httpMetadata.contentType); },
      };
    },
    async delete(keys) {
      spend();
      const list = Array.isArray(keys) ? keys : [keys];
      calls.delete.push(list.length);
      if (list.length > R2_BATCH_LIMIT) throw new Error(`R2 delete accepts at most ${R2_BATCH_LIMIT} keys, got ${list.length}`);
      for (const key of list) values.delete(key);
    },
    async list({ prefix = "", cursor, limit = R2_BATCH_LIMIT, include = [] } = {}) {
      spend();
      calls.list.push({ prefix, cursor, limit, include: [...include] });
      if (limit > R2_BATCH_LIMIT) throw new Error(`R2 list limit is at most ${R2_BATCH_LIMIT}, got ${limit}`);
      const after = cursor ? decodeURIComponent(String(cursor).replace(/^r2-cursor:/, "")) : "";
      const keys = [...values.keys()].filter((key) => key.startsWith(prefix) && key > after).sort();
      const page = keys.slice(0, Math.min(limit, pageCap));
      const truncated = keys.length > page.length;
      return {
        truncated,
        ...(truncated ? { cursor: `r2-cursor:${encodeURIComponent(page[page.length - 1])}` } : {}),
        objects: page.map((key) => {
          const item = values.get(key);
          return {
            key,
            size: item.bytes.length,
            ...(include.includes("customMetadata") ? { customMetadata: item.customMetadata ?? {} } : {}),
            ...(include.includes("httpMetadata") ? { httpMetadata: item.httpMetadata ?? {} } : {}),
          };
        }),
      };
    },
  };
}
