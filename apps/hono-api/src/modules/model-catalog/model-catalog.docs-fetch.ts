import { AppError } from "../../middleware/error";
import type {
	FetchModelCatalogDocsInput,
	ModelCatalogDocsFetchResult,
} from "./model-catalog.schemas";

const MAX_DOC_TEXT_CHARS = 120_000;
const MAX_RESPONSE_BYTES = 800_000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

type FetchLike = typeof fetch;

function assertAllowedDocsUrl(rawUrl: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new AppError("Invalid docs URL", {
			status: 400,
			code: "invalid_docs_url",
		});
	}

	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new AppError("Only http/https docs URLs are allowed", {
			status: 400,
			code: "invalid_docs_url_scheme",
		});
	}

	const hostname = parsed.hostname.toLowerCase();
	if (!hostname) {
		throw new AppError("Docs URL host is required", {
			status: 400,
			code: "invalid_docs_url_host",
		});
	}

	if (
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local") ||
		hostname === "0.0.0.0" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname === "[::1]"
	) {
		throw new AppError("Local docs URLs are not allowed", {
			status: 400,
			code: "blocked_docs_url_host",
		});
	}

	if (isBlockedIpv4Host(hostname) || isBlockedIpv6Host(hostname)) {
		throw new AppError("Private network docs URLs are not allowed", {
			status: 400,
			code: "blocked_docs_url_host",
		});
	}

	parsed.username = "";
	parsed.password = "";
	return parsed;
}

function isBlockedIpv4Host(hostname: string): boolean {
	const parts = hostname.split(".");
	if (parts.length !== 4) return false;
	const octets = parts.map((part) => Number(part));
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return false;
	}
	const [a, b] = octets;
	return (
		a === 10 ||
		a === 127 ||
		a === 0 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168)
	);
}

function isBlockedIpv6Host(hostname: string): boolean {
	const normalized = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
	return (
		normalized === "::1" ||
		normalized.startsWith("fc") ||
		normalized.startsWith("fd") ||
		normalized.startsWith("fe80:")
	);
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeBasicHtmlEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/g, "'");
}

function extractTitleFromHtml(html: string): string | null {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!match?.[1]) return null;
	const title = normalizeWhitespace(decodeBasicHtmlEntities(stripHtmlTags(match[1])));
	return title || null;
}

function stripHtmlTags(value: string): string {
	return value.replace(/<[^>]+>/g, " ");
}

function htmlToText(html: string): string {
	const withoutScripts = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
	const withBreaks = withoutScripts
		.replace(/<\/(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|table|pre)>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n");
	return normalizeWhitespace(decodeBasicHtmlEntities(stripHtmlTags(withBreaks)));
}

function responseTextToEvidence(input: {
	body: string;
	contentType: string;
}): { title: string | null; text: string } {
	const contentType = input.contentType.toLowerCase();
	if (contentType.includes("text/html") || /<html[\s>]/i.test(input.body)) {
		return {
			title: extractTitleFromHtml(input.body),
			text: htmlToText(input.body),
		};
	}
	return {
		title: null,
		text: normalizeWhitespace(input.body),
	};
}

export async function fetchModelCatalogDocs(
	input: FetchModelCatalogDocsInput,
	deps?: { fetchImpl?: FetchLike },
): Promise<ModelCatalogDocsFetchResult> {
	const requestedUrl = assertAllowedDocsUrl(input.url);
	const fetchImpl = deps?.fetchImpl || fetch;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	let currentUrl = requestedUrl;
	let response: Response | null = null;
	const diagnostics: string[] = [];
	try {
		for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
			response = await fetchImpl(currentUrl.toString(), {
				method: "GET",
				redirect: "manual",
				signal: controller.signal,
				headers: {
					Accept: "text/html,application/json,text/plain,application/xml,text/xml;q=0.9,*/*;q=0.5",
						"User-Agent": "Nomi-Model-Integration-Agent/1.0",
				},
			});
			if (![301, 302, 303, 307, 308].includes(response.status)) {
				break;
			}
			const location = response.headers.get("location");
			if (!location) {
				throw new AppError("Docs fetch redirect missing location", {
					status: 502,
					code: "docs_fetch_bad_redirect",
				});
			}
			if (redirectCount === MAX_REDIRECTS) {
				throw new AppError("Docs fetch exceeded redirect limit", {
					status: 502,
					code: "docs_fetch_redirect_limit",
				});
			}
			const nextUrl = assertAllowedDocsUrl(new URL(location, currentUrl).toString());
			diagnostics.push(`redirect ${redirectCount + 1}: ${currentUrl.toString()} -> ${nextUrl.toString()}`);
			currentUrl = nextUrl;
		}
	} catch (error) {
		if (error instanceof AppError) throw error;
		const message = error instanceof Error && error.message ? error.message : "fetch failed";
		throw new AppError(`Docs fetch failed: ${message}`, {
			status: 502,
			code: "docs_fetch_failed",
		});
	} finally {
		clearTimeout(timeout);
	}

	if (!response) {
		throw new AppError("Docs fetch did not return a response", {
			status: 502,
			code: "docs_fetch_empty_response",
		});
	}

	const finalUrl = currentUrl;
	const contentType = response.headers.get("content-type") || "";
	const contentLength = Number(response.headers.get("content-length") || "0");
	if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
		throw new AppError("Docs response is too large", {
			status: 413,
			code: "docs_response_too_large",
		});
	}
	if (!response.ok) {
		throw new AppError(`Docs fetch returned HTTP ${response.status}`, {
			status: 502,
			code: "docs_fetch_bad_status",
			details: { upstreamStatus: response.status },
		});
	}

	const body = await response.text();
	if (body.length > MAX_RESPONSE_BYTES) {
		diagnostics.push(`response body truncated from ${body.length} chars before extraction`);
	}
	const boundedBody = body.slice(0, MAX_RESPONSE_BYTES);
	const evidence = responseTextToEvidence({ body: boundedBody, contentType });
	const truncated = evidence.text.length > MAX_DOC_TEXT_CHARS;
	const text = evidence.text.slice(0, MAX_DOC_TEXT_CHARS);
	if (truncated) {
		diagnostics.push(`extracted text truncated to ${MAX_DOC_TEXT_CHARS} chars`);
	}

	return {
		url: requestedUrl.toString(),
		finalUrl: finalUrl.toString(),
		status: response.status,
		contentType,
		title: evidence.title,
		text,
		truncated,
		diagnostics,
	};
}
