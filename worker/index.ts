import { type AssetsFetcher, type ExecutionContextLike, serveAssetWithRanges } from "./byteRange";
import { ACK_PATH } from "./kieSunoAck";

const ACK_BODY = JSON.stringify({ status: "received" });

export type WorkerEnv = { ASSETS: AssetsFetcher };

// Workers runtime global (not in the DOM/Node libs this repo type-checks against).
declare const FixedLengthStream: new (length: number) => TransformStream<Uint8Array, Uint8Array>;

/**
 * Stateless KIE/Suno callback sink. It deliberately never reads the request
 * body, headers or query string: callbacks are acknowledged and discarded.
 * Production deployment is a separate approval-gated step.
 *
 * Every other request that reaches the worker (media via `run_worker_first`,
 * paths with no asset) is answered by ASSETS, with edge-cached byte ranges.
 */
export default {
  async fetch(request: Request, env: WorkerEnv, ctx?: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === ACK_PATH) {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
      }
      return new Response(ACK_BODY, {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    return serveAssetWithRanges(request, env.ASSETS, (length) => new FixedLengthStream(length), ctx);
  },
};
