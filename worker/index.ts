const ACK_PATH = "/api/vendor-callbacks/kie/suno/ack";
const ACK_BODY = JSON.stringify({ status: "received" });

type AssetsBinding = { fetch(request: Request): Promise<Response> };
export type WorkerEnv = { ASSETS?: AssetsBinding };

/**
 * Stateless KIE/Suno callback sink. It deliberately never reads the request
 * body, headers or query string: callbacks are acknowledged and discarded.
 * Production deployment is a separate approval-gated step.
 */
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
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
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not Found", { status: 404 });
  },
};

export { ACK_PATH };
