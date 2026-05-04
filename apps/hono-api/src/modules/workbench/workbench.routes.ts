import { Hono } from "hono";
import type { Next } from "hono";
import type { AppContext, AppEnv } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { authMiddleware } from "../../middleware/auth";
import { errorMiddleware } from "../../middleware/error";
import { resolveLocalDevRole } from "../auth/local-admin";
import { handlePublicAgentsChatRoute } from "../agents-bridge";

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
