import type { AppContext } from "../../types";
import type { TaskRequestDto } from "../task/task.schemas";

type NodeProcessLike = {
	env?: Record<string, string | undefined>;
	versions?: {
		node?: string;
	};
};

type AgentsBridgeFetchInit = RequestInit & {
	dispatcher?: unknown;
};

const nodeFetchDispatcherCache = new Map<number, unknown>();

function readRecordProperty(value: unknown, key: string): unknown {
	if (!value || typeof value !== "object") return undefined;
	return (value as Record<string, unknown>)[key];
}

export function readErrorStringProperty(value: unknown, key: string): string {
	const raw = readRecordProperty(value, key);
	return typeof raw === "string" ? raw : "";
}

export function readErrorCauseStringProperty(value: unknown, key: string): string {
	const cause = readRecordProperty(value, "cause");
	return readErrorStringProperty(cause, key);
}

function getNodeProcess(): NodeProcessLike | null {
	const processRef = (globalThis as { process?: NodeProcessLike }).process;
	return processRef && typeof processRef === "object" ? processRef : null;
}

function readOptionalProcessEnv(name: string): string | undefined {
	const value = getNodeProcess()?.env?.[name];
	return typeof value === "string" ? value : undefined;
}

function readProcessEnv(name: string): string {
	return readOptionalProcessEnv(name) ?? "";
}

function readTaskExtras(request: TaskRequestDto): Record<string, unknown> {
	const extras = request.extras;
	if (!extras || typeof extras !== "object" || Array.isArray(extras)) return {};
	return extras;
}

export function isNodeRuntime(): boolean {
	return Boolean(getNodeProcess()?.versions?.node);
}

export function readBoolEnvFlag(value: unknown): boolean {
	const v = String(value ?? "")
		.trim()
		.toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function readAgentsBridgeBaseUrl(c: AppContext): string {
	const rawFromEnv =
		typeof c.env.AGENTS_BRIDGE_BASE_URL === "string"
			? c.env.AGENTS_BRIDGE_BASE_URL
			: "";
	const rawFromProcess = readProcessEnv("AGENTS_BRIDGE_BASE_URL");
	const raw = rawFromEnv || rawFromProcess;
	return raw.trim().replace(/\/+$/, "");
}

export function readNomiApiBaseFromEnv(c: AppContext): string {
	const rawInternal =
		typeof c.env.TAPCANVAS_API_INTERNAL_BASE === "string"
			? c.env.TAPCANVAS_API_INTERNAL_BASE
			: "";
	const rawBase =
		typeof c.env.TAPCANVAS_API_BASE_URL === "string"
			? c.env.TAPCANVAS_API_BASE_URL
			: "";
	const rawProcessInternal = readProcessEnv("TAPCANVAS_API_INTERNAL_BASE");
	const rawProcessBase = readProcessEnv("TAPCANVAS_API_BASE_URL");
	const raw = rawInternal || rawBase || rawProcessInternal || rawProcessBase;
	return raw.trim().replace(/\/+$/, "");
}

export function readAgentsBridgeDebugLog(c: AppContext): boolean {
	const fromEnv = readBoolEnvFlag(c.env.AGENTS_BRIDGE_DEBUG_LOG);
	if (fromEnv) return true;
	const fromProcess = readProcessEnv("AGENTS_BRIDGE_DEBUG_LOG");
	return readBoolEnvFlag(fromProcess);
}

export function shouldDropOnHeadersTimeout(
	c: AppContext,
	request: TaskRequestDto,
): boolean {
	const extras = readTaskExtras(request);
	if (typeof extras.bridgeDropOnTimeout === "boolean") return extras.bridgeDropOnTimeout;
	const fromEnv = readBoolEnvFlag(c.env.AGENTS_BRIDGE_DROP_ON_TIMEOUT);
	if (fromEnv) return true;
	const fromProcess = readOptionalProcessEnv("AGENTS_BRIDGE_DROP_ON_TIMEOUT");
	if (typeof fromProcess !== "undefined") return readBoolEnvFlag(fromProcess);
	return true;
}

export function isConnRefusedError(err: unknown): boolean {
	const msg = readErrorStringProperty(err, "message");
	const cause = readErrorCauseStringProperty(err, "message");
	const combined = `${msg}\n${cause}`.toLowerCase();
	return combined.includes("econnrefused") || combined.includes("connect refused");
}

export function isHeadersTimeoutError(err: unknown): boolean {
	const msg = readErrorStringProperty(err, "message");
	const causeMsg = readErrorCauseStringProperty(err, "message");
	const code = readErrorStringProperty(err, "code") || readErrorCauseStringProperty(err, "code");
	const combined = `${msg}\n${causeMsg}`.toLowerCase();
	return (
		combined.includes("headers timeout") ||
		combined.includes("und_err_headers_timeout") ||
		code === "UND_ERR_HEADERS_TIMEOUT"
	);
}

export async function createNodeFetchDispatcher(
	timeoutMs: number,
): Promise<unknown | null> {
	if (!isNodeRuntime()) return null;
	const key = Math.max(5_000, Math.floor(timeoutMs));
	if (nodeFetchDispatcherCache.has(key)) {
		return nodeFetchDispatcherCache.get(key) || null;
	}
	try {
		const undici = await import("undici");
		const dispatcher = new undici.Agent({
			headersTimeout: key + 15_000,
			bodyTimeout: key + 15_000,
		});
		nodeFetchDispatcherCache.set(key, dispatcher);
		return dispatcher;
	} catch {
		return null;
	}
}

export function truncateForDebugLog(input: unknown, maxChars = 1200): string {
	const text = String(input ?? "");
	if (!text) return "";
	return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export async function maybeStartAgentsBridgeOnDemand(c: AppContext): Promise<string> {
	if (!isNodeRuntime()) return readAgentsBridgeBaseUrl(c);
	try {
		const mod = await import("../../platform/node/agents-bridge-autostart");
		if (typeof mod?.maybeAutostartAgentsBridge === "function") {
			await mod.maybeAutostartAgentsBridge();
		}
		const processBase = readProcessEnv("AGENTS_BRIDGE_BASE_URL").trim();
		if (processBase) {
			c.env.AGENTS_BRIDGE_BASE_URL = processBase;
		}
	} catch {
		// best effort: caller will preserve existing explicit error handling
	}
	return readAgentsBridgeBaseUrl(c);
}

export function readAgentsBridgeToken(c: AppContext): string | null {
	const raw =
		typeof c.env.AGENTS_BRIDGE_TOKEN === "string" ? c.env.AGENTS_BRIDGE_TOKEN : "";
	const trimmed = raw.trim();
	return trimmed ? trimmed : null;
}

export function readAgentsBridgeTimeoutMs(c: AppContext): number {
	const raw =
		typeof c.env.AGENTS_BRIDGE_TIMEOUT_MS === "string"
			? c.env.AGENTS_BRIDGE_TIMEOUT_MS
			: "";
	const n = Number(raw);
	if (Number.isFinite(n) && n > 0) {
		return Math.max(5_000, Math.min(1_800_000, Math.floor(n)));
	}
	return 600_000;
}

export function readAgentsBridgeMaxConcurrency(c: AppContext): number {
	const rawFromEnv =
		typeof c.env.AGENTS_BRIDGE_MAX_CONCURRENCY === "string"
			? c.env.AGENTS_BRIDGE_MAX_CONCURRENCY
			: "";
	const rawFromProcess = readProcessEnv("AGENTS_BRIDGE_MAX_CONCURRENCY");
	const raw = rawFromEnv || rawFromProcess;
	const n = Number(raw);
	if (Number.isFinite(n) && n > 0) {
		return Math.max(1, Math.min(6, Math.trunc(n)));
	}
	return 1;
}

export function isAgentsBridgeEnabled(c: AppContext): boolean {
	return !!readAgentsBridgeBaseUrl(c);
}

export type { AgentsBridgeFetchInit };
