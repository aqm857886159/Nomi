// 接入文档的**单一来源裁决**：用户/驱动 Agent 给了文档就用它，没给才去猜域名爬公开文档站。
//
// 治的是 2026-09-10 盘点出的第一处断链：`nomi_integration begin` 一直收 `docs`（≤64KB），
// 但它只落进 session config 与投影，**从来没有流到编译器**——编译器只吃 `docsDiscovery.ts`
// 按 `docs.<注册域>` 猜出来的页面。于是「照着接口文档接一家新供应商」这条路上，
// 用户明明把文档递到了手里，我们还在门口猜他家有没有文档站；杂牌中转站、内网网关、
// 只在 PDF/飞书里有文档的供应商全都接不进来。
//
// 为什么裁决住在这一个函数里，而不是写在 service 的 default dependency 里：
// `discover` 是可注入依赖，测试可以整个换掉它。规则写在依赖默认值上 = 规则可被绕过；
// 写在这里 = 两条路（给了/没给）都从同一个函数出去，可以对着它单测「给了就不猜」。
import { hardenedFetchText } from "../hardenedFetch";
import { createExplicitProxyDispatcher } from "../systemProxy";
import crypto from "node:crypto";
import {
  discoverProviderDocs,
  readableText,
  pageTitle,
  truncateUtf8,
  type DiscoveredDocs,
  type DocsFetchText,
} from "./docsDiscovery";

/** 与 `nomi_integration.docs` 的 MCP 上限同一个数（electron/capabilityCore/mcpIntegrationTools.ts）。 */
export const MAX_PROVIDED_DOCS_BYTES = 64 * 1024;
/** 一次最多替用户抓这么多篇文档页；超出的 URL 原样报错，不静默丢。 */
export const MAX_PROVIDED_DOCS_URLS = 16;

export type ProvidedDocsSource =
  | { kind: "urls"; urls: string[] }
  | { kind: "text"; text: string };

/**
 * 正文还是 URL 列表。判据是「每一行都是 http(s) URL」——只要有一行不是，整份按正文处理，
 * 不做「挑出里面的链接去抓」这种猜测：那会把一篇正文里引用的第三方链接当成文档来源。
 */
export function parseProvidedDocs(raw: unknown): ProvidedDocsSource | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  const lines = value.split(/\s+/).filter(Boolean);
  const allUrls = lines.length > 0 && lines.every((line) => /^https?:\/\/\S+$/i.test(line));
  if (allUrls) {
    const urls = [...new Set(lines)];
    if (urls.length > MAX_PROVIDED_DOCS_URLS) {
      throw new Error(`Provided documentation lists ${urls.length} URLs; at most ${MAX_PROVIDED_DOCS_URLS} are fetched`);
    }
    return { kind: "urls", urls };
  }
  return { kind: "text", text: value };
}

/**
 * 正文那条路也必须有一个 URL：说明卡的 `sources[].url` 与 `mode.sourceUrls` 都是
 * `z.string().url()`，而且模式必须引用 sources 里出现过的地址（validator.ts）。
 * 我们不拿供应商域名冒充出处（那是编造来源），改用内容寻址的 URN——它诚实地说
 * 「这份证据来自用户交进来的文档，指纹是这个」，复核时能对上原文。
 */
export function providedDocsUrn(text: string): string {
  return `urn:nomi:integration-docs:${crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32)}`;
}

const PROVIDED_DOCS_TITLE = "Operator-supplied API documentation";

async function fetchProvidedDocUrls(input: {
  urls: readonly string[];
  fetchText: DocsFetchText;
  signal?: AbortSignal;
  proxyUrl?: string;
  maxCorpusBytes: number;
}): Promise<DiscoveredDocs> {
  const dispatcher = input.proxyUrl ? createExplicitProxyDispatcher(input.proxyUrl) : undefined;
  const sources: DiscoveredDocs["sources"] = [];
  let corpus = "";
  try {
    for (const url of input.urls) {
      if (input.signal?.aborted) {
        throw input.signal.reason instanceof Error ? input.signal.reason : new Error("Document fetch cancelled");
      }
      const remaining = input.maxCorpusBytes - Buffer.byteLength(corpus);
      if (remaining <= 0) break;
      // 抓取一律走既有的 hardenedFetchText（SSRF/私网/大小/超时全在里面），不新写抓取。
      const result = await input.fetchText(url, {
        maxBytes: 1_000_000,
        timeoutMs: 8_000,
        signal: input.signal,
        allowContentTypes: ["text/", "application/json", "application/xml", "application/yaml"],
        ...(dispatcher ? { dispatcher } : {}),
      });
      const text = truncateUtf8(readableText(result.text, result.contentType), remaining);
      if (!text.trim()) continue;
      const finalUrl = result.finalUrl || url;
      sources.push({ url: finalUrl, title: pageTitle(result.text) || PROVIDED_DOCS_TITLE, text });
      corpus = `${corpus ? `${corpus}\n\n` : ""}SOURCE: ${finalUrl}\n${text}`;
    }
    return { sources, corpus };
  } finally {
    if (dispatcher) await dispatcher.close().catch(() => undefined);
  }
}

export function providedDocsFromText(raw: string, maxCorpusBytes = MAX_PROVIDED_DOCS_BYTES): DiscoveredDocs {
  const text = truncateUtf8(raw, maxCorpusBytes);
  if (!text.trim()) return { sources: [], corpus: "" };
  const url = providedDocsUrn(text);
  return { sources: [{ url, title: PROVIDED_DOCS_TITLE, text }], corpus: `SOURCE: ${url}\n${text}` };
}

/**
 * 编译器的文档来源边界。**给了 `providedDocs` 就只用它**（正文直接用、URL 列表用
 * hardenedFetchText 抓），没给才回落到按域名猜的 `discoverProviderDocs`。
 */
export async function resolveProviderDocs(input: {
  baseUrl: string;
  modelKeys: readonly string[];
  providedDocs?: string;
  proxyUrl?: string;
  signal?: AbortSignal;
  fetchText?: DocsFetchText;
  maxCorpusBytes?: number;
}): Promise<DiscoveredDocs> {
  const parsed = parseProvidedDocs(input.providedDocs);
  if (!parsed) {
    return discoverProviderDocs({
      baseUrl: input.baseUrl,
      modelKeys: input.modelKeys,
      ...(input.proxyUrl ? { proxyUrl: input.proxyUrl } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.fetchText ? { fetchText: input.fetchText } : {}),
    });
  }
  const maxCorpusBytes = input.maxCorpusBytes ?? MAX_PROVIDED_DOCS_BYTES;
  if (parsed.kind === "text") return providedDocsFromText(parsed.text, maxCorpusBytes);
  return fetchProvidedDocUrls({
    urls: parsed.urls,
    fetchText: input.fetchText || hardenedFetchText,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.proxyUrl ? { proxyUrl: input.proxyUrl } : {}),
    maxCorpusBytes,
  });
}
