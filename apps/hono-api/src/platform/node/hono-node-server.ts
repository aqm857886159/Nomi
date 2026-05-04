import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { ExecutionContext } from "@cloudflare/workers-types";

import type { WorkerEnv } from "../../types";

type HonoLike = {
	fetch: (req: Request, env?: WorkerEnv, ctx?: ExecutionContext) => Promise<Response> | Response;
};

type RequestInitWithDuplex = RequestInit & {
	duplex?: "half";
};

type HeadersWithSetCookie = Headers & {
	getSetCookie?: () => string[];
};

function hasResponseStarted(res: ServerResponse): boolean {
	return Boolean(res.headersSent || res.writableEnded);
}

function getHeaderValue(req: IncomingMessage, name: string): string | undefined {
	const value = req.headers[name.toLowerCase()];
	if (Array.isArray(value)) return value[0];
	if (typeof value === "string") return value;
	return undefined;
}

function buildRequestFromNode(req: IncomingMessage): Request {
	const host = getHeaderValue(req, "host") || "localhost";
	const proto = getHeaderValue(req, "x-forwarded-proto") || "http";
	const url = new URL(req.url || "/", `${proto}://${host}`);

	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (typeof value === "undefined") continue;
		if (Array.isArray(value)) {
			value.forEach((item) => headers.append(key, item));
			continue;
		}
		headers.set(key, value);
	}

	const method = String(req.method || "GET").toUpperCase();
	const hasBody = !(method === "GET" || method === "HEAD");
	const init: RequestInitWithDuplex = {
		method,
		headers,
	};

	if (hasBody) {
		init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
		init.duplex = "half";
	}

	return new Request(url, init);
}

function createWaitUntilContext(): ExecutionContext {
	return {
		waitUntil(promise: Promise<unknown>) {
			promise.catch((err) => {
				// eslint-disable-next-line no-console
				console.warn("[api] waitUntil rejected", err);
			});
		},
		passThroughOnException() {
			// Node runtime has no Worker exception passthrough target.
		},
		props: undefined,
	};
}

async function writeResponseToNode(
	res: ServerResponse,
	response: Response,
): Promise<void> {
	res.statusCode = response.status;

	const setCookies = (response.headers as HeadersWithSetCookie).getSetCookie?.() ?? [];
	if (setCookies.length > 0) {
		res.setHeader("Set-Cookie", setCookies);
	}

	response.headers.forEach((value, key) => {
		if (key.toLowerCase() === "set-cookie") return;
		res.setHeader(key, value);
	});

	if (!response.body) {
		res.end();
		return;
	}

	const nodeStream = Readable.fromWeb(
		response.body as NodeReadableStream<Uint8Array>,
	);
	await new Promise<void>((resolve, reject) => {
		nodeStream.on("error", reject);
		res.on("error", reject);
		res.on("close", resolve);
		res.on("finish", resolve);
		nodeStream.pipe(res);
	});
}

function writeInternalError(res: ServerResponse, err: unknown): void {
	res.statusCode = 500;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(
		JSON.stringify({
			error: "internal_error",
			message: err instanceof Error ? err.message : String(err),
		}),
	);
}

export function createHonoNodeServer(honoApp: HonoLike, env: WorkerEnv) {
	return createServer(async (req, res) => {
		try {
			const request = buildRequestFromNode(req);
			const response = await honoApp.fetch(request, env, createWaitUntilContext());
			await writeResponseToNode(res, response);
		} catch (err) {
			if (hasResponseStarted(res)) {
				// eslint-disable-next-line no-console
				console.error("[api] response failed after headers sent", err);
				return;
			}
			writeInternalError(res, err);
		}
	});
}
