import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModelList } from "./modelListProbe";

vi.mock("../../systemProxy", () => ({
  describeNetworkError: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

afterEach(() => vi.unstubAllGlobals());

function response(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

function probe(baseUrl = "https://gateway.test", headers: Record<string, string> = {}, query?: Record<string, string>) {
  return fetchModelList("openai-compatible", baseUrl, headers, new AbortController().signal, { query });
}

describe("model discovery failures are actionable across candidate routes", () => {
  it.each([401, 403, 429, 502])("does not hide HTTP %s behind a later 404", async (status) => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(status, { error: { message: "actionable upstream reason" } }))
      .mockResolvedValueOnce(response(404, { message: "No message available" })));
    const result = await probe();
    expect(result).toMatchObject({
      ok: false, status, statuses: [status, 404],
      failureKind: status === 429 ? "rate_limit" : status >= 500 ? "upstream" : "auth",
    });
    expect(result).toMatchObject({ error: expect.stringContaining(`HTTP ${status}`) });
    expect(result).toMatchObject({ error: expect.stringContaining("actionable upstream reason") });
  });

  it.each([401, 429, 503])("does not hide HTTP %s behind a valid empty list", async (status) => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(status, { message: "failed" }))
      .mockResolvedValueOnce(response(200, { data: [] })));
    expect(await probe()).toMatchObject({ ok: false, status, statuses: [status, 200] });
  });

  it("does not hide a later auth error behind an earlier empty list", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(200, { data: [] }))
      .mockResolvedValueOnce(response(401, { message: "bad key" })));
    expect(await probe()).toMatchObject({ ok: false, failureKind: "auth", status: 401 });
  });

  it.each([
    [{ code: 401, data: [], message: "expired key" }, "auth"],
    [{ status: 403, data: [] }, "auth"],
    [{ error: { code: "invalid_api_key", message: "expired key" }, data: [] }, "auth"],
    [{ error: { type: "rate_limit_error", message: "slow down" }, data: [] }, "rate_limit"],
    [{ code: 429, data: [] }, "rate_limit"],
    [{ success: false, data: [], message: "backend unavailable" }, "upstream"],
    [{ status: "error", data: [] }, "upstream"],
  ])("classifies an HTTP-200 business error before parsing: %j", async (body, failureKind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, body)));
    expect(await probe("https://gateway.test/v1")).toMatchObject({ ok: false, failureKind, status: 200, statuses: [200] });
  });

  it("does not misclassify 404 followed by a network failure as unsupported", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(404, {}))
      .mockRejectedValueOnce(new Error("network unavailable")));
    const result = await probe();
    expect(result).toMatchObject({ ok: false, failureKind: "network", error: expect.stringContaining("network unavailable"), statuses: [404] });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Next:") });
  });

  it("uses unsupported only when all candidates actually lack a list route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(404, { message: "No message available" })));
    const result = await probe();
    expect(result).toMatchObject({ ok: false, failureKind: "unsupported", statuses: [404, 404] });
    expect(result).toMatchObject({ error: expect.stringContaining("HTTP 404") });
    expect(result).toMatchObject({ error: expect.stringContaining("Next:") });
  });

  it("explains an HTTP-200 business failure with its body and repair action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      success: false,
      error: { code: "invalid_api_key", message: "key rejected" },
    })));
    const result = await probe("https://gateway.test/v1");
    expect(result).toMatchObject({ ok: false, status: 200, failureKind: "auth" });
    expect(result).toMatchObject({ error: expect.stringContaining("key rejected") });
    expect(result).toMatchObject({ error: expect.stringContaining("Next:") });
  });

  it("recognizes HTML as invalid_response but keeps trying the compatible route", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(200, "<!doctype html><title>dashboard</title>"))
      .mockResolvedValueOnce(response(200, { data: [{ id: "real-model" }] })));
    expect(await probe()).toEqual({ ok: true, models: ["real-model"], statuses: [200, 200] });
  });

  it("returns invalid_response for a malformed list, not empty success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, { data: [{ id: {} }] })));
    expect(await probe("https://gateway.test/v1")).toMatchObject({ ok: false, failureKind: "invalid_response" });
  });

  it("allows a later valid nonempty endpoint to win an earlier mismatched auth failure", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(200, { data: ["available"] })));
    expect(await probe()).toEqual({ ok: true, models: ["available"], statuses: [401, 200] });
  });

  it("retains a valid empty list when only an unsupported fallback route follows", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(200, { data: [] }))
      .mockResolvedValueOnce(response(404, {})));
    expect(await probe()).toEqual({ ok: true, models: [], statuses: [200, 404] });
  });

  it("retains an auth HTTP status even when reading its error body fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 401, text: async () => { throw new Error("socket closed during body"); },
    })));
    expect(await probe("https://gateway.test/v1"))
      .toMatchObject({ ok: false, failureKind: "auth", status: 401, statuses: [401] });
  });
});

describe("model discovery URLs and credential safety", () => {
  it.each(["https://gateway.test/v1/", "https://gateway.test/api/v3", "https://gateway.test/prefix/v1beta"])(
    "does not duplicate an already-versioned path: %s", async (baseUrl) => {
      const fetchSpy = vi.fn().mockResolvedValue(response(404, {}));
      vi.stubGlobal("fetch", fetchSpy);
      await probe(baseUrl);
      expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([`${baseUrl.replace(/\/+$/, "")}/models`]);
    },
  );

  it("does not append a second v1 for Anthropic", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response(200, { data: [{ id: "claude-a" }], has_more: false }));
    vi.stubGlobal("fetch", fetchSpy);
    await fetchModelList("anthropic", "https://gateway.test/v1/", {}, new AbortController().signal);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://gateway.test/v1/models");
  });

  it("joins the path before existing query parameters and never reveals credentials", async () => {
    const token = "private /+? token";
    const fetchSpy = vi.fn(async (url: string) => response(401, {
      message: `key ${token}, encoded ${encodeURIComponent(token)}, url ${url}, header custom-secret`,
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await probe(`https://gateway.test/v1?tenant_secret=${encodeURIComponent(token)}`, { "X-Private": "custom-secret" });
    expect(new URL(fetchSpy.mock.calls[0][0]).pathname).toBe("/v1/models");
    const output = JSON.stringify(result);
    expect(output).not.toContain(token);
    expect(output).not.toContain(encodeURIComponent(token));
    expect(output).not.toContain("custom-secret");
    expect(output).not.toContain("tenant_secret=");
  });

  it("redacts bearer and query secrets echoed in a network exception", async () => {
    const token = "key / spaces+";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { throw new Error(`Failed ${url} / ${encodeURIComponent(token)} / bearer-secret`); }));
    const result = await probe("https://gateway.test/v1", { authorization: "Bearer bearer-secret" }, { access: token });
    const output = JSON.stringify(result);
    expect(output).not.toContain(token);
    expect(output).not.toContain(encodeURIComponent(token));
    expect(output).not.toContain("bearer-secret");
    expect(output).not.toContain("access=");
  });

  it("does not automatically follow a cross-host redirect carrying custom auth", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response(302, "", { location: "https://attacker.test/models" }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await probe("https://gateway.test/v1", { "X-Private": "secret" })).toMatchObject({ ok: false, failureKind: "invalid_response" });
    expect(fetchSpy).toHaveBeenCalledWith("https://gateway.test/v1/models", expect.objectContaining({ redirect: "manual" }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("redacts secrets before truncating long plaintext upstream errors", async () => {
    const secret = "private-token-that-crosses-the-error-truncation-boundary";
    vi.stubGlobal("fetch", vi.fn(async () => response(500, `${"x".repeat(290)}${secret}`)));
    const result = await probe("https://gateway.test/v1", { "X-Custom-Auth": secret });
    expect(result).toMatchObject({ ok: false, failureKind: "upstream" });
    expect(JSON.stringify(result)).not.toContain("private-to");
  });

  it.each([401, 200])("redacts nested details before shared message formatting truncates them (HTTP %s)", async (status) => {
    const secret = "private-token-crossing-the-nested-details-boundary";
    vi.stubGlobal("fetch", vi.fn(async () => response(status, {
      code: 401, data: [], error: { message: "rejected", details: `${"x".repeat(190)}${secret}` },
    })));
    const result = await probe("https://gateway.test/v1", { "X-Private": secret });
    expect(result).toMatchObject({ ok: false, failureKind: "auth", status });
    expect(JSON.stringify(result)).not.toContain("private-to");
  });

  it("classifies an unusable saved credential header before sending any request", async () => {
    const fetchSpy = vi.fn(async () => response(200, { data: ["model"] }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await probe("https://gateway.test/v1", { "X-Private": "key\nvalue" }))
      .toMatchObject({ ok: false, failureKind: "auth", statuses: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("model-list pagination follows the proven response protocol", () => {
  it("collects native results pages on any host, preserving exact names and auth query", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(response(200, { results: [{ owner: "a", name: "same" }], next: "/v1/models?cursor=next", previous: null }))
      .mockResolvedValueOnce(response(200, { results: [{ owner: "a", name: "same" }, { owner: "b", name: "same" }], next: null, previous: "/v1/models" }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await probe("https://relay.test/v1", { authorization: "Bearer secret" }, { key: "query-secret" }))
      .toEqual({ ok: true, models: ["a/same", "b/same"], statuses: [200, 200] });
    const second = new URL(fetchSpy.mock.calls[1][0]);
    expect(second.pathname).toBe("/v1/models");
    expect(second.searchParams.get("cursor")).toBe("next");
    expect(second.searchParams.get("key")).toBe("query-secret");
  });

  it.each(["https://attacker.test/v1/models", "https://relay.test/other", "http://relay.test/v1/models", "https://user:pass@relay.test/v1/models", 42])(
    "rejects unsafe or malformed next links without partial success: %s", async (next) => {
      const fetchSpy = vi.fn().mockResolvedValue(response(200, { results: [{ owner: "a", name: "model" }], next }));
      vi.stubGlobal("fetch", fetchSpy);
      const result = await probe("https://relay.test/v1", { "X-Key": "secret" });
      expect(result).toMatchObject({ ok: false, failureKind: "invalid_response" });
      expect(result).not.toHaveProperty("partial");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it("detects repeated pagination URLs without retrying or truncating silently", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response(200, { results: [{ owner: "a", name: "model" }], next: "/v1/models" }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await probe("https://relay.test/v1")).toMatchObject({ ok: false, failureKind: "invalid_response" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never labels a failed second page as a complete or partial success", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(200, { results: [{ owner: "a", name: "model" }], next: "/v1/models?cursor=second" }))
      .mockResolvedValueOnce(response(401, { message: "expired midway" })));
    expect(await probe("https://relay.test/v1")).toMatchObject({ ok: false, failureKind: "auth", status: 401, statuses: [200, 401] });
  });

  it.each([
    { name: "404", makeLast: () => Promise.resolve(response(404, { message: "missing cursor" })), lastStatus: 404 },
    { name: "500", makeLast: () => Promise.resolve(response(500, { message: "server fault" })), lastStatus: 500 },
    { name: "invalid response", makeLast: () => Promise.resolve(response(200, "<html>dashboard</html>")), lastStatus: 200 },
    { name: "network error", makeLast: () => Promise.reject(new Error("socket closed")), lastStatus: undefined },
    { name: "malformed pagination", makeLast: () => Promise.resolve(response(200, { results: [{ owner: "a", name: "other" }], next: 42 })), lastStatus: 200 },
  ])("keeps an earlier auth failure when a confirmed endpoint's later page fails: $name", async ({ makeLast, lastStatus }) => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(response(401, { message: "original auth rejection" }))
      .mockResolvedValueOnce(response(200, { results: [{ owner: "a", name: "model" }], next: "/v1/models?cursor=second" }))
      .mockImplementationOnce(makeLast);
    vi.stubGlobal("fetch", fetchSpy);
    const result = await probe("https://relay.test");
    expect(result).toMatchObject({
      ok: false, failureKind: "auth", status: 401, error: expect.stringContaining("original auth rejection"),
      statuses: lastStatus === undefined ? [401, 200] : [401, 200, lastStatus],
    });
    expect(result).not.toHaveProperty("partial");
  });

  it.each(["https://attacker.test/v1/models", "/v1/models", "https://"])(
    "keeps an earlier auth failure when a candidate has unsafe, repeated, or invalid pagination: %s", async (next) => {
      const fetchSpy = vi.fn()
        .mockResolvedValueOnce(response(401, { message: "original auth rejection" }))
        .mockResolvedValueOnce(response(200, { results: [{ owner: "a", name: "model" }], next }));
      vi.stubGlobal("fetch", fetchSpy);
      expect(await probe("https://relay.test"))
        .toMatchObject({ ok: false, failureKind: "auth", status: 401, error: expect.stringContaining("original auth rejection"), statuses: [401, 200] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    },
  );

  it("marks a page-budget stop partial, not complete", async () => {
    const fetchSpy = vi.fn(async (raw: string) => {
      const page = Number(new URL(raw).searchParams.get("page") || 0);
      return response(200, { results: [{ owner: "a", name: `model-${page}` }], next: `/v1/models?page=${page + 1}` });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await probe("https://relay.test/v1");
    expect(result).toMatchObject({ ok: true, partial: true });
    expect(fetchSpy).toHaveBeenCalledTimes(10);
    if (result.ok) expect(result.models).toHaveLength(10);
  });

  it("marks the model-budget limit partial even when the last page says next:null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      data: Array.from({ length: 2001 }, (_, i) => ({ id: `model-${i}` })),
    })));
    const result = await probe("https://relay.test/v1");
    expect(result).toMatchObject({ ok: true, partial: true });
    if (result.ok) expect(result.models).toHaveLength(2000);
  });

  it("follows the official Anthropic has_more/last_id cursor without a hostname condition", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(response(200, { data: [{ id: "claude-a" }], has_more: true, first_id: "claude-a", last_id: "claude-a" }))
      .mockResolvedValueOnce(response(200, { data: [{ id: "claude-b" }], has_more: false, first_id: "claude-b", last_id: "claude-b" }));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchModelList("anthropic", "https://relay.test", {}, new AbortController().signal);
    expect(result).toEqual({ ok: true, models: ["claude-a", "claude-b"], statuses: [200, 200] });
    expect(new URL(fetchSpy.mock.calls[1][0]).searchParams.get("after_id")).toBe("claude-a");
  });
});
