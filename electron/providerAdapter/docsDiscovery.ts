import { hardenedFetchText } from "../hardenedFetch";
import { createExplicitProxyDispatcher } from "../systemProxy";

export type DocsFetchText = typeof hardenedFetchText;

export type DiscoveredDocs = {
  sources: Array<{ url: string; title?: string; text: string }>;
  corpus: string;
};

const MULTIPART_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "com.au",
  "com.br",
  "com.cn",
  "com.hk",
  "co.jp",
  "co.kr",
  "co.nz",
  "com.sg",
  "com.tw",
]);

// 主机名有没有可能存在公开文档站。没有 → 根本不该去猜 docs./wiki. 子域。
//
// 为什么必须先问这一句（issue #62 根因）：registrableDomain 是「按域名取注册域」的逻辑，对
// IP 字面量是胡来——192.168.18.254 会被截成 "18.254"，拼出 http://docs.18.254；按 WHATWG 规则
// 主机末段是纯数字要当 IPv4 解析，"docs" 不是数字 → new URL 直接抛 Invalid URL，整个接入流程判死。
// 而且就算不抛也没意义：局域网/本机地址（自建 ComfyUI、Ollama、内网中转）不可能有公开文档站。
export function canHostPublicDocs(hostname: string): boolean {
  const host = hostname.toLowerCase().trim().replace(/\.$/, "");
  if (!host) return false;
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  // IP 字面量（含公网 IP：docs.203.0.113.5 同样不存在）。IPv6 靠冒号判，不依赖 node:net 以便同构复用。
  if (bare.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) return false;
  if (host === "localhost") return false;
  return ![".localhost", ".local", ".internal", ".home.arpa"].some((suffix) => host.endsWith(suffix));
}

function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const suffix = parts.slice(-2).join(".");
  return MULTIPART_PUBLIC_SUFFIXES.has(suffix) ? parts.slice(-3).join(".") : suffix;
}

function isProviderSite(url: URL, domain: string): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" || url.protocol === "http:"
    ? host === domain || host.endsWith(`.${domain}`)
    : false;
}

function normalizedUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  return url.toString();
}

function seedUrls(baseUrl: URL, domain: string, modelKeys: readonly string[]): string[] {
  const origin = baseUrl.origin;
  const apex = `${baseUrl.protocol}//${domain}`;
  const docs = `${baseUrl.protocol}//docs.${domain}`;
  const wiki = `${baseUrl.protocol}//wiki.${domain}`;
  const modelIds = [...new Set(modelKeys.flatMap((key) => [key.toLowerCase(), key.toLowerCase().replace(/\./g, "")]))];
  const modelPaths = modelIds.flatMap((id) => [`/doc/${id}`, `/docs/${id}`, `/en/docs/${id}`]);
  const commonPaths = ["/llms.txt", "/openapi.json", "/swagger.json", "/sitemap.xml", "/docs", "/doc", "/doc/overview"];
  return [...new Set([
    origin,
    apex,
    docs,
    ...[apex, docs, origin].flatMap((host) => modelPaths.map((part) => normalizedUrl(`${host}${part}`))),
    ...[origin, apex, docs, wiki].flatMap((host) => commonPaths.map((part) => normalizedUrl(`${host}${part}`))),
  ].map(normalizedUrl))];
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function readableText(raw: string, contentType: string): string {
  if (!contentType.toLowerCase().includes("html") && !/<(?:html|body|p|h\d|a)\b/i.test(raw)) {
    return raw.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  return decodeHtmlEntities(
    raw
      .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(?:p|div|li|h\d|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function pageTitle(raw: string): string | undefined {
  const match = raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || raw.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? readableText(match[1], "text/html").slice(0, 300) : undefined;
}

function discoveredLinks(raw: string, pageUrl: string, modelKeys: readonly string[]): string[] {
  const needles = ["doc", "api", "openapi", "swagger", "reference", "developer", "model", ...modelKeys]
    .map((value) => value.toLowerCase());
  const links: string[] = [];
  for (const match of raw.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1].trim();
    if (!href || href.startsWith("#") || /^(?:mailto|javascript|data):/i.test(href)) continue;
    const label = readableText(match[2], "text/html").toLowerCase();
    const candidate = `${href} ${label}`.toLowerCase();
    if (!needles.some((needle) => candidate.includes(needle))) continue;
    try {
      links.push(normalizedUrl(new URL(href, pageUrl).toString()));
    } catch {
      // Ignore malformed third-party documentation links.
    }
  }
  return links;
}

function appendWithinBytes(current: string, next: string, maxBytes: number): string {
  const separator = current ? "\n\n" : "";
  const remaining = maxBytes - Buffer.byteLength(current) - Buffer.byteLength(separator);
  if (remaining <= 0) return current;
  const bytes = Buffer.from(next, "utf8");
  return `${current}${separator}${bytes.subarray(0, remaining).toString("utf8")}`;
}

function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  return bytes.subarray(0, Math.max(0, maxBytes)).toString("utf8").replace(/\uFFFD$/, "");
}

export async function discoverProviderDocs(options: {
  baseUrl: string;
  modelKeys: readonly string[];
  signal?: AbortSignal;
  proxyUrl?: string;
  fetchText?: DocsFetchText;
  maxPages?: number;
  maxCorpusBytes?: number;
}): Promise<DiscoveredDocs> {
  const baseUrl = new URL(options.baseUrl);
  // 不可能有公开文档站的主机（IP 字面量 / localhost / 内网域）：不猜、不爬、不抛，诚实返回「没有」。
  // 调用方据此改走内置 OpenAI 兼容契约，而不是把用户的自建端点判成接入失败。
  if (!canHostPublicDocs(baseUrl.hostname)) return { sources: [], corpus: "" };
  const domain = registrableDomain(baseUrl.hostname);
  const fetchText = options.fetchText || hardenedFetchText;
  const dispatcher = options.proxyUrl ? createExplicitProxyDispatcher(options.proxyUrl) : undefined;
  const maxPages = options.maxPages ?? 16;
  const maxCorpusBytes = options.maxCorpusBytes ?? 160_000;
  const queue = seedUrls(baseUrl, domain, options.modelKeys);
  const seen = new Set<string>();
  const seenFinal = new Set<string>();
  const sources: DiscoveredDocs["sources"] = [];
  let corpus = "";
  let attempts = 0;
  const maxAttempts = Math.max(maxPages * 4, maxPages + 8);

  while (queue.length > 0 && sources.length < maxPages && attempts < maxAttempts && Buffer.byteLength(corpus) < maxCorpusBytes) {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error ? options.signal.reason : new Error("Document discovery cancelled");
    }
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const currentUrl = new URL(current);
    if (!isProviderSite(currentUrl, domain)) continue;
    attempts += 1;
    try {
      const result = await fetchText(current, {
        maxBytes: 1_000_000,
        timeoutMs: 8_000,
        signal: options.signal,
        allowContentTypes: ["text/", "application/json", "application/xml", "application/yaml"],
        ...(dispatcher ? { dispatcher } : {}),
      });
      const finalUrl = normalizedUrl(result.finalUrl || current);
      if (!isProviderSite(new URL(finalUrl), domain)) continue;
      const text = readableText(result.text, result.contentType);
      if (!text) continue;
      if (!seenFinal.has(finalUrl)) {
        seenFinal.add(finalUrl);
        const remaining = Math.max(0, maxCorpusBytes - Buffer.byteLength(corpus) - Buffer.byteLength(`SOURCE: ${finalUrl}\n\n`));
        const boundedText = truncateUtf8(text, remaining);
        if (boundedText) {
          sources.push({ url: finalUrl, title: pageTitle(result.text), text: boundedText });
          corpus = appendWithinBytes(corpus, `SOURCE: ${finalUrl}\n${boundedText}`, maxCorpusBytes);
        }
      }
      const links = discoveredLinks(result.text, finalUrl, options.modelKeys)
        .filter((link) => !seen.has(link) && isProviderSite(new URL(link), domain));
      queue.unshift(...links);
    } catch (error) {
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error ? options.signal.reason : error;
      }
      // Discovery is best-effort across a bounded list; one missing conventional path is expected.
    }
  }

  return { sources, corpus };
}
