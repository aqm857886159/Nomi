import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCredentialElicitationStore } from "./credentialElicitation";
import { handleIntegrationCredentialHttpRequest, scrub } from "./credentialElicitationHttp";

const SECRET = "sk-live-do-not-leak-1234567890";
const display = { name: "APIMart", baseUrl: "https://api.example.com/v1", authType: "bearer" };

type Harness = {
  origin: string;
  token: string;
  saved: Array<{ sessionId: string; apiKey: string }>;
  close: () => Promise<void>;
};

const servers: Array<() => Promise<void>> = [];

async function harness(options: { testCredential?: (sessionId: string, apiKey: string) => Promise<number>; onSave?: () => void } = {}): Promise<Harness> {
  const saved: Array<{ sessionId: string; apiKey: string }> = [];
  let origin = "";
  const store = createCredentialElicitationStore({ originResolver: () => origin });
  const deps = {
    store,
    saveCredential: (sessionId: string, apiKey: string) => {
      options.onSave?.();
      saved.push({ sessionId, apiKey });
    },
    ...(options.testCredential ? { testCredential: options.testCredential } : {}),
  };
  const server = http.createServer((req, res) => {
    void handleIntegrationCredentialHttpRequest(req, res, deps).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ticket = store.mint({ sessionId: "integration-http-1", display })!;
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  servers.push(close);
  return { origin, token: new URL(ticket.url).searchParams.get("t")!, saved, close };
}

const post = async (origin: string, route: string, body: unknown) =>
  fetch(`${origin}/integration-credential${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

afterEach(async () => {
  while (servers.length) await servers.pop()!();
  vi.restoreAllMocks();
});

describe("credential elicitation page", () => {
  it("renders the provider identity read-only and never a key field value", async () => {
    const h = await harness();
    const res = await fetch(`${h.origin}/integration-credential?t=${h.token}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("APIMart");
    expect(html).toContain("https://api.example.com/v1");
    expect(html).toContain('type="password"');
    // The page is self-contained: no remote script/style can be smuggled into a credential form.
    expect(html).not.toMatch(/src="https?:/);
  });

  it("shows the expired page for an unknown or spent token", async () => {
    const h = await harness();
    const res = await fetch(`${h.origin}/integration-credential?t=${"0".repeat(64)}`);
    expect(res.status).toBe(410);
    expect(await res.text()).not.toContain('type="password"');
  });

  it("saves through the trusted writer once, and echoes no key in the response", async () => {
    const h = await harness();
    const res = await post(h.origin, "/save", { t: h.token, apiKey: SECRET });
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
    expect(body).not.toContain(SECRET);
    expect(h.saved).toEqual([{ sessionId: "integration-http-1", apiKey: SECRET }]);
    // Single use: the same token cannot save again.
    const replay = await post(h.origin, "/save", { t: h.token, apiKey: SECRET });
    expect(replay.status).toBe(400);
    expect(h.saved).toHaveLength(1);
  });

  it("never writes the key to a log, even when the trusted writer throws", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const h = await harness({ onSave: () => { throw new Error(`upstream rejected ${SECRET}`); } });
    const res = await post(h.origin, "/save", { t: h.token, apiKey: SECRET });
    const body = await res.text();
    expect(res.status).toBe(400);
    // The failing dependency quoted the key back at us; the boundary scrubs it out regardless.
    expect(body).not.toContain(SECRET);
    expect(body).toContain("[redacted]");
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
    }
  });

  it("tests a key without consuming the ticket", async () => {
    const probed: string[] = [];
    const h = await harness({
      testCredential: async (_sessionId, apiKey) => {
        probed.push(apiKey);
        return 7;
      },
    });
    const first = await post(h.origin, "/test", { t: h.token, apiKey: "wrong-key" });
    expect(await first.json()).toEqual({ ok: true, count: 7 });
    const second = await post(h.origin, "/test", { t: h.token, apiKey: SECRET });
    expect(await second.json()).toEqual({ ok: true, count: 7 });
    expect(probed).toEqual(["wrong-key", SECRET]);
    // Still saveable afterwards — testing is not spending the ticket.
    expect((await post(h.origin, "/save", { t: h.token, apiKey: SECRET })).status).toBe(200);
  });

  it("rejects an empty key and a non-JSON body without touching the writer", async () => {
    const h = await harness();
    expect((await post(h.origin, "/save", { t: h.token, apiKey: "  " })).status).toBe(400);
    const raw = await fetch(`${h.origin}/integration-credential/save`, { method: "POST", body: "not json" });
    expect(raw.status).toBe(400);
    expect(h.saved).toHaveLength(0);
  });

  it("leaves unrelated paths to the host server", async () => {
    const h = await harness();
    expect((await fetch(`${h.origin}/production-preview?preview=x`)).status).toBe(404);
  });
});

describe("scrub", () => {
  it("removes every occurrence of the secret and leaves short/empty secrets alone", () => {
    expect(scrub(`a ${SECRET} b ${SECRET}`, SECRET)).toBe("a [redacted] b [redacted]");
    expect(scrub("nothing here", "")).toBe("nothing here");
    expect(scrub("ab", "ab")).toBe("ab");
  });
});
