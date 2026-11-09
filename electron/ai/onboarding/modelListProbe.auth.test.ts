import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthHeaders, fetchModelList } from "./modelListProbe";

afterEach(() => vi.unstubAllGlobals());

describe("fetchModelList saved authentication", () => {
  it('uses native Google auth and preserves it through native pageToken pagination', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'models/a' }], nextPageToken: 'two' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'models/b' }] })))
    vi.stubGlobal('fetch', fetchSpy)
    const headers = buildAuthHeaders('google-generative-ai', 'test-key', { 'x-tenant': 't' })
    expect(headers).toMatchObject({ 'x-goog-api-key': 'test-key', 'x-tenant': 't' })
    const result = await fetchModelList('google-generative-ai', 'https://relay.test/gateway/v1beta', headers, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, models: ['a', 'b'] })
    expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual(['https://relay.test/gateway/v1beta/models', 'https://relay.test/gateway/v1beta/models?pageToken=two'])
    for (const call of fetchSpy.mock.calls) expect(call[1].headers).toMatchObject({ 'x-goog-api-key': 'test-key' })
  })
  it("puts query-auth credentials on every candidate URL", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "model-a" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchModelList(
      "openai-compatible",
      "https://api.example.test/v1",
      { "x-gateway": "tenant-a" },
      new AbortController().signal,
      { query: { api_key: "secret-query-key" } },
    );

    expect(result).toMatchObject({ ok: true, models: ["model-a"] });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.test/v1/models?api_key=secret-query-key",
      expect.objectContaining({ headers: { "x-gateway": "tenant-a" } }),
    );
  });
});
