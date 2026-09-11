import { describe, expect, it, vi } from "vitest";
import { MAX_PROVIDED_DOCS_URLS, parseProvidedDocs, providedDocsUrn, resolveProviderDocs } from "./providedDocs";
import { adapterDraftSchema } from "./validator";

// 一条不变量：**用户/驱动 Agent 给了文档就用它，没给才去猜域名。**
// 断言的是「编译器最终吃到的是哪份语料」，不是「哪个函数被调用了」——后者换个实现就假绿。

type FetchCall = { url: string };

function recordingFetch(pages: Record<string, string>) {
  const calls: FetchCall[] = [];
  const fetchText = vi.fn(async (url: string) => {
    calls.push({ url });
    const body = pages[url];
    if (body === undefined) throw new Error(`404 ${url}`);
    return { text: body, contentType: "text/plain", status: 200, finalUrl: url, truncated: false };
  });
  return { calls, fetchText: fetchText as unknown as Parameters<typeof resolveProviderDocs>[0]["fetchText"] };
}

describe("parseProvidedDocs", () => {
  it("treats an all-URL payload as a URL list and anything else as prose", () => {
    expect(parseProvidedDocs("https://a.example/doc\nhttps://b.example/doc")).toEqual({
      kind: "urls",
      urls: ["https://a.example/doc", "https://b.example/doc"],
    });
    // 一行不是 URL → 整份按正文，不去「挑出里面的链接」猜。
    expect(parseProvidedDocs("POST /v1/images\nsee https://a.example/doc")).toEqual({
      kind: "text",
      text: "POST /v1/images\nsee https://a.example/doc",
    });
    expect(parseProvidedDocs("   ")).toBeNull();
    expect(parseProvidedDocs(undefined)).toBeNull();
  });

  it("refuses more URLs than it will actually fetch instead of silently dropping the tail", () => {
    const urls = Array.from({ length: MAX_PROVIDED_DOCS_URLS + 1 }, (_, index) => `https://a.example/${index}`);
    expect(() => parseProvidedDocs(urls.join("\n"))).toThrowError(/at most 16/);
  });
});

describe("resolveProviderDocs", () => {
  it("uses supplied prose verbatim and never touches the network", async () => {
    const { calls, fetchText } = recordingFetch({});
    const providedDocs = "POST /v1/videos\nBody: {prompt, duration}\nPoll GET /v1/videos/{id}";

    const docs = await resolveProviderDocs({
      baseUrl: "https://api.example.com/v1",
      modelKeys: ["vid-1"],
      providedDocs,
      fetchText,
    });

    expect(calls).toEqual([]);
    expect(docs.sources).toHaveLength(1);
    expect(docs.sources[0].text).toBe(providedDocs);
    expect(docs.corpus).toContain(providedDocs);
    // 出处诚实：内容寻址的 URN，不拿供应商域名冒充「从某个页面读来的」。
    expect(docs.sources[0].url).toBe(providedDocsUrn(providedDocs));
    expect(docs.sources[0].url.startsWith("urn:nomi:integration-docs:")).toBe(true);
  });

  it("mints a source URL the adapter draft validator accepts, so a prose-sourced contract can be promoted", () => {
    const url = providedDocsUrn("POST /v1/images");
    const parsed = adapterDraftSchema.safeParse({
      provider: { baseUrl: "https://api.example.com/v1", authType: "bearer" },
      sources: [{ url, evidence: "POST /v1/images" }],
      models: [
        {
          modelKey: "paint-v2",
          labelZh: "Paint V2",
          kind: "image",
          modes: [
            {
              taskKind: "text_to_image",
              create: { method: "POST", path: "/images", response_mapping: { image_url: "data.0.url" } },
              sourceUrls: [url],
            },
          ],
        },
      ],
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("fetches a supplied URL list through the hardened fetch and keeps only those pages", async () => {
    const { calls, fetchText } = recordingFetch({
      "https://intranet-portal.example/relay-api": "POST /relay/v1/images — the only page that matters",
    });

    const docs = await resolveProviderDocs({
      baseUrl: "https://api.example.com/v1",
      modelKeys: ["paint-v2"],
      providedDocs: "https://intranet-portal.example/relay-api",
      fetchText,
    });

    expect(calls.map((call) => call.url)).toEqual(["https://intranet-portal.example/relay-api"]);
    expect(docs.sources.map((source) => source.url)).toEqual(["https://intranet-portal.example/relay-api"]);
    expect(docs.sources[0].text).toContain("POST /relay/v1/images");
  });

  it("falls back to guessing the provider's documentation site only when nothing was supplied", async () => {
    const { calls, fetchText } = recordingFetch({
      "https://docs.example.com/docs": "Guessed documentation site",
    });

    const docs = await resolveProviderDocs({
      baseUrl: "https://api.example.com/v1",
      modelKeys: ["paint-v2"],
      fetchText,
    });

    // 猜的那条路的指纹：它去敲了 docs.<注册域> 这种约定路径。
    expect(calls.some((call) => call.url.startsWith("https://docs.example.com/"))).toBe(true);
    expect(docs.sources.map((source) => source.url)).toEqual(["https://docs.example.com/docs"]);
  });

  it("stops guessing entirely once documentation is supplied", async () => {
    const { calls, fetchText } = recordingFetch({
      "https://docs.example.com/docs": "Guessed documentation site",
    });

    const docs = await resolveProviderDocs({
      baseUrl: "https://api.example.com/v1",
      modelKeys: ["paint-v2"],
      providedDocs: "POST /v1/images returns data[0].url",
      fetchText,
    });

    expect(calls).toEqual([]);
    expect(docs.corpus).not.toContain("Guessed documentation site");
  });
});
