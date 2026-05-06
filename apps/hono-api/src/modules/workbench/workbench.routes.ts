import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Next } from "hono";
import type { AppContext, AppEnv } from "../../types";
import { subscribeWorkspaceEvents } from "./workspace-events";
import { getPrismaClient } from "../../platform/node/prisma";
import { authMiddleware } from "../../middleware/auth";
import { errorMiddleware } from "../../middleware/error";
import { resolveLocalDevRole } from "../auth/local-admin";
import { handlePublicAgentsChatRoute } from "../agents-bridge";
import { registerWorkspaceToolRoutes } from "./workspace-tools.routes.js";

export const workbenchRouter = new Hono<AppEnv>();

function isLocalDevRequest(c: { req: { url: string } }): boolean {
	try {
		const host = new URL(c.req.url).hostname.trim().toLowerCase();
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "0.0.0.0" ||
			host === "::1"
		);
	} catch {
		return false;
	}
}

async function ensureLocalDevUserRow(c: AppContext, userId: string): Promise<void> {
	const nowIso = new Date().toISOString();
	const prisma = getPrismaClient();
	const existing = await prisma.users.findUnique({
		where: { id: userId },
		select: { id: true },
	});
	if (existing) {
		await prisma.users.update({
			where: { id: userId },
			data: {
				last_seen_at: nowIso,
				updated_at: nowIso,
			},
		});
		return;
	}
	await prisma.users.create({
		data: {
			id: userId,
		login: "local-dev",
		name: "local-dev",
		avatar_url: null,
		email: null,
		role: resolveLocalDevRole(c, "admin"),
		guest: 1,
		last_seen_at: nowIso,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
}

workbenchRouter.use("*", errorMiddleware);
workbenchRouter.use("*", async (c, next: Next) => {
	if (isLocalDevRequest(c)) {
		const userId = "local-dev-user";
		c.set("userId", userId);
		c.set("auth", {
			sub: userId,
			login: "local-dev",
			role: "admin",
			guest: true,
		});
		await ensureLocalDevUserRow(c, userId);
		return next();
	}
	return authMiddleware(c, next);
});

workbenchRouter.post("/agents/chat", async (c) => {
	return handlePublicAgentsChatRoute(c);
});

registerWorkspaceToolRoutes(workbenchRouter);

workbenchRouter.get("/events", (c) => {
	const projectId = c.req.query("projectId") || "";
	return streamSSE(c, async (stream) => {
		const unsub = subscribeWorkspaceEvents(projectId, async (event) => {
			await stream.writeSSE({ data: JSON.stringify(event) });
		});
		const hb = setInterval(() => {
			void stream.writeSSE({ data: JSON.stringify({ type: "heartbeat", ts: new Date().toISOString() }) });
		}, 15000);
		await stream.sleep(300000);
		clearInterval(hb);
		unsub();
	});
});
