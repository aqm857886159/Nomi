import http from "node:http";
import type { AddressInfo } from "node:net";
import { setCredentialElicitationOrigin } from "./credentialElicitation";
import { handleIntegrationCredentialHttpRequest } from "./credentialElicitationHttp";
import { createRuntimeCredentialElicitationHttpDeps } from "./credentialElicitationRuntime";

// A dedicated 127.0.0.1 listener for the credential page, deliberately NOT folded into the artifact
// preview server. That server exists to stream media to embedded viewers, so it answers with
// `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`. A page that takes
// an API key must be the opposite: no cross-origin reach at all, `default-src 'none'`, no-store. Two
// listeners with two postures is the honest shape; one listener with per-route header exceptions is
// how a permissive default eventually leaks onto the strict route.
//
// Both hosts start exactly one of these: the GUI (rpcServer.ts) and the headless stdio server
// (mcpStdioServer.ts). Whichever process owns the integration session is the one that mints the URL,
// so its own listener is always the one the URL points at.

export type CredentialElicitationServer = { port: number; origin: string; close: () => Promise<void> };

export function startCredentialElicitationServer(): Promise<CredentialElicitationServer> {
  const deps = createRuntimeCredentialElicitationHttpDeps();
  const server = http.createServer((req, res) => {
    void handleIntegrationCredentialHttpRequest(req, res, deps)
      .catch(() => false)
      .then((handled) => {
        if (!handled && !res.headersSent) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          res.end("Not found");
        }
      });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    // 0.0.0.0 绝不用——只 127.0.0.1，外网/局域网够不着这张表单。
    server.listen(0, "127.0.0.1", () => {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      setCredentialElicitationOrigin(origin);
      resolve({
        port: (server.address() as AddressInfo).port,
        origin,
        close: () =>
          new Promise<void>((resolveClose) =>
            server.close(() => {
              setCredentialElicitationOrigin(null);
              resolveClose();
            }),
          ),
      });
    });
  });
}
