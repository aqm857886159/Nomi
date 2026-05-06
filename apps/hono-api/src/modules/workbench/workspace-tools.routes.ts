import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { AppEnv } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	getProjectForOwner,
	listProjectsByOwner,
} from "../project/project.repo";
import {
	getFlowForOwner,
	mapFlowRowToDto,
	updateFlow,
} from "../flow/flow.repo";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import { listAssetsForUser } from "../asset/asset.repo";
import {
	listChaptersByProjectForOwner,
	getChapterByIdForOwner,
	updateChapterRow,
} from "../chapter/chapter.repo";
import { generateImageToCanvas } from "../task/agents-tool-bridge.generate-image-to-canvas";
import { generateVideoToCanvas } from "../task/agents-tool-bridge.generate-video-to-canvas";

type Router = Hono<AppEnv>;

const TIMELINE_ASSET_KIND = "workbench_timeline_state";

function ok(result: unknown) {
	return { ok: true as const, result };
}

function err(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return { ok: false as const, error: message };
}

export function registerWorkspaceToolRoutes(router: Router): void {
	router.post("/tools/:tool", async (c) => {
		const tool = c.req.param("tool");
		const userIdRaw = c.get("userId");
		if (!userIdRaw) return c.json({ ok: false, error: "unauthorized" }, 401);
		const userId: string = userIdRaw;
		const body = await c.req.json().catch(() => ({}));
		const { projectId, flowId } = body as Record<string, unknown>;
		const db = getPrismaClient();

		try {
			// ── workspace ──────────────────────────────────────────────────────
			if (tool === "workspace.read") {
				if (!projectId || typeof projectId !== "string") throw new Error("projectId required");
				const project = await getProjectForOwner(db, projectId, userId);
				if (!project) throw new Error("project not found");
				return c.json(ok(project));
			}

			if (tool === "workspace.list_projects") {
				const projects = await listProjectsByOwner(db, userId);
				return c.json(ok({ projects }));
			}

			// ── canvas ─────────────────────────────────────────────────────────
			if (tool === "canvas.read") {
				if (!flowId || typeof flowId !== "string") throw new Error("flowId required");
				const row = await getFlowForOwner(db, flowId, userId);
				if (!row) throw new Error("flow not found");
				return c.json(ok(mapFlowRowToDto(row)));
			}

			if (tool === "canvas.create_nodes") {
				if (!flowId || typeof flowId !== "string") throw new Error("flowId required");
				const row = await getFlowForOwner(db, flowId, userId);
				if (!row) throw new Error("flow not found");
				const patch = (body as Record<string, unknown>).patch;
				const patched = applyPublicFlowGraphPatch({
					current: JSON.parse(row.data || "{}"),
					patch: patch as Parameters<typeof applyPublicFlowGraphPatch>[0]["patch"],
				});
				const nowIso = new Date().toISOString();
				const updated = await updateFlow(db, {
					id: row.id,
					name: row.name,
					data: JSON.stringify(sanitizeFlowDataForStorage(patched.data)),
					ownerId: userId,
					projectId: row.project_id,
					nowIso,
				});
				return c.json(ok({ flow: updated ? mapFlowRowToDto(updated) : null, stats: patched.stats }));
			}

			if (tool === "canvas.update_node") {
				if (!flowId || typeof flowId !== "string") throw new Error("flowId required");
				const { nodeId, data: nodeData } = body as Record<string, unknown>;
				if (!nodeId || typeof nodeId !== "string") throw new Error("nodeId required");
				const row = await getFlowForOwner(db, flowId, userId);
				if (!row) throw new Error("flow not found");
				const graph = JSON.parse(row.data || "") as { nodes?: unknown[] };
				const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
				const idx = nodes.findIndex((n) => (n as Record<string, unknown>).id === nodeId);
				if (idx === -1) throw new Error("node not found");
				const existing = nodes[idx] as Record<string, unknown>;
				nodes[idx] = { ...existing, data: { ...(existing.data as object), ...(nodeData as object) } };
				const nowIso = new Date().toISOString();
				const updated = await updateFlow(db, {
					id: row.id,
					name: row.name,
					data: JSON.stringify(sanitizeFlowDataForStorage({ ...graph, nodes })),
					ownerId: userId,
					projectId: row.project_id,
					nowIso,
				});
				return c.json(ok({ flow: updated ? mapFlowRowToDto(updated) : null }));
			}

			if (tool === "canvas.connect_nodes") {
				if (!flowId || typeof flowId !== "string") throw new Error("flowId required");
				const { source, target, sourceHandle, targetHandle } = body as Record<string, unknown>;
				if (!source || !target) throw new Error("source and target required");
				const row = await getFlowForOwner(db, flowId, userId);
				if (!row) throw new Error("flow not found");
				const graph = JSON.parse(row.data || "{}") as { nodes?: unknown[]; edges?: unknown[] };
				const edges = Array.isArray(graph.edges) ? [...graph.edges] : [];
				edges.push({
					id: randomUUID(),
					source,
					target,
					...(sourceHandle ? { sourceHandle } : {}),
					...(targetHandle ? { targetHandle } : {}),
				});
				const nowIso = new Date().toISOString();
				const updated = await updateFlow(db, {
					id: row.id,
					name: row.name,
					data: JSON.stringify(sanitizeFlowDataForStorage({ ...graph, edges })),
					ownerId: userId,
					projectId: row.project_id,
					nowIso,
				});
				return c.json(ok({ flow: updated ? mapFlowRowToDto(updated) : null }));
			}

			if (tool === "canvas.delete_node") {
				if (!flowId || typeof flowId !== "string") throw new Error("flowId required");
				const { nodeId } = body as Record<string, unknown>;
				if (!nodeId || typeof nodeId !== "string") throw new Error("nodeId required");
				const row = await getFlowForOwner(db, flowId, userId);
				if (!row) throw new Error("flow not found");
				const graph = JSON.parse(row.data || "{}") as { nodes?: unknown[]; edges?: unknown[] };
				const nodes = (Array.isArray(graph.nodes) ? graph.nodes : []).filter(
					(n) => (n as Record<string, unknown>).id !== nodeId,
				);
				const edges = (Array.isArray(graph.edges) ? graph.edges : []).filter(
					(e) => {
						const edge = e as Record<string, unknown>;
						return edge.source !== nodeId && edge.target !== nodeId;
					},
				);
				const nowIso = new Date().toISOString();
				const updated = await updateFlow(db, {
					id: row.id,
					name: row.name,
					data: JSON.stringify(sanitizeFlowDataForStorage({ ...graph, nodes, edges })),
					ownerId: userId,
					projectId: row.project_id,
					nowIso,
				});
				return c.json(ok({ flow: updated ? mapFlowRowToDto(updated) : null }));
			}

			if (tool === "canvas.run_node") {
				if (!flowId || typeof flowId !== "string") throw new Error("flowId required");
				const row = await getFlowForOwner(db, flowId, userId);
				if (!row) throw new Error("flow not found");
				const { nodeId } = body as Record<string, unknown>;
				if (!nodeId || typeof nodeId !== "string") throw new Error("nodeId required");
				const graph = JSON.parse(row.data || "{}") as { nodes?: unknown[] };
				const node = (Array.isArray(graph.nodes) ? graph.nodes : []).find(
					(n) => (n as Record<string, unknown>).id === nodeId,
				) as Record<string, unknown> | undefined;
				if (!node) throw new Error("node not found");
				const nodeData = (node.data ?? {}) as Record<string, unknown>;
				const kind = typeof nodeData.kind === "string" ? nodeData.kind : "";
				const devBypass = Boolean(c.get("devPublicBypass" as never));
				if (kind.startsWith("video")) {
					const result = await generateVideoToCanvas({
						c: c as Parameters<typeof generateVideoToCanvas>[0]["c"],
						requestUserId: userId,
						devBypass,
						flowId,
						row,
						bodyArgs: body,
					});
					return c.json(ok(result));
				}
				const result = await generateImageToCanvas({
					c: c as Parameters<typeof generateImageToCanvas>[0]["c"],
					requestUserId: userId,
					devBypass,
					flowId,
					row,
					bodyArgs: body,
				});
				return c.json(ok(result));
			}

			// ── timeline ───────────────────────────────────────────────────────
			if (tool === "timeline.read") {
				if (!projectId || typeof projectId !== "string") throw new Error("projectId required");
				const asset = await db.assets.findFirst({
					where: {
						owner_id: userId,
						project_id: projectId,
						data: { contains: `"kind":"${TIMELINE_ASSET_KIND}"` },
					},
					orderBy: { updated_at: "desc" },
				});
				const state = asset?.data
					? (() => { try { return JSON.parse(asset.data); } catch { return null; } })()
					: null;
				return c.json(ok({ timeline: state ?? { tracks: [], fps: 30, scale: 1, playheadFrame: 0 } }));
			}

			if (tool === "timeline.add_clip" || tool === "timeline.remove_clip" || tool === "timeline.update_clip") {
				if (!projectId || typeof projectId !== "string") throw new Error("projectId required");
				const existing = await db.assets.findFirst({
					where: {
						owner_id: userId,
						project_id: projectId,
						data: { contains: `"kind":"${TIMELINE_ASSET_KIND}"` },
					},
					orderBy: { updated_at: "desc" },
				});
				const state: { kind: string; tracks: unknown[]; fps: number; scale: number; playheadFrame: number } = existing?.data
					? (() => { try { return JSON.parse(existing.data); } catch { return { kind: TIMELINE_ASSET_KIND, tracks: [], fps: 30, scale: 1, playheadFrame: 0 }; } })()
					: { kind: TIMELINE_ASSET_KIND, tracks: [], fps: 30, scale: 1, playheadFrame: 0 };

				if (tool === "timeline.add_clip") {
					const { clip } = body as Record<string, unknown>;
					if (!clip) throw new Error("clip required");
					const clipObj = clip as Record<string, unknown>;
					if (!clipObj.id) clipObj.id = randomUUID();
					state.tracks = [...state.tracks, clipObj];
				} else if (tool === "timeline.remove_clip") {
					const { clipId } = body as Record<string, unknown>;
					if (!clipId) throw new Error("clipId required");
					state.tracks = state.tracks.filter(
						(t) => (t as Record<string, unknown>).id !== clipId,
					);
				} else {
					const { clipId, updates } = body as Record<string, unknown>;
					if (!clipId) throw new Error("clipId required");
					state.tracks = state.tracks.map((t) => {
						const track = t as Record<string, unknown>;
						return track.id === clipId ? { ...track, ...(updates as object) } : track;
					});
				}

				const nowIso = new Date().toISOString();
				if (existing) {
					await db.assets.update({
						where: { id: existing.id },
						data: { data: JSON.stringify(state), updated_at: nowIso },
					});
				} else {
					await db.assets.create({
						data: {
							id: randomUUID(),
							name: "timeline-state",
							data: JSON.stringify(state),
							owner_id: userId,
							project_id: projectId as string,
							created_at: nowIso,
							updated_at: nowIso,
						},
					});
				}
				return c.json(ok({ timeline: state }));
			}

			// ── creation ───────────────────────────────────────────────────────
			if (tool === "creation.read") {
				if (!projectId || typeof projectId !== "string") throw new Error("projectId required");
				const chapters = await listChaptersByProjectForOwner({
					db: db as Parameters<typeof listChaptersByProjectForOwner>[0]["db"],
					projectId,
					ownerId: userId,
				});
				return c.json(ok({ chapters }));
			}

			if (tool === "creation.append_text") {
				if (!projectId || typeof projectId !== "string") throw new Error("projectId required");
				const { chapterId, text } = body as Record<string, unknown>;
				if (!chapterId || typeof chapterId !== "string") throw new Error("chapterId required");
				if (typeof text !== "string") throw new Error("text required");
				const chapter = await getChapterByIdForOwner({
					db: db as Parameters<typeof getChapterByIdForOwner>[0]["db"],
					chapterId,
					ownerId: userId,
				});
				if (!chapter) throw new Error("chapter not found");
				const newSummary = chapter.summary ? chapter.summary + "\n" + text : text;
				const nowIso = new Date().toISOString();
				await updateChapterRow({
					db: db as Parameters<typeof updateChapterRow>[0]["db"],
					chapterId,
					ownerId: userId,
					summary: newSummary,
					nowIso,
				});
				return c.json(ok({ chapterId, appended: text }));
			}

			// ── asset ──────────────────────────────────────────────────────────
			if (tool === "asset.list") {
				const { limit, cursor, kind } = body as Record<string, unknown>;
				const assets = await listAssetsForUser(
					db as Parameters<typeof listAssetsForUser>[0],
					userId,
					{
						projectId: typeof projectId === "string" ? projectId : null,
						limit: typeof limit === "number" ? limit : 20,
						cursor: typeof cursor === "string" ? cursor : null,
						kind: typeof kind === "string" ? kind : null,
					},
				);
				return c.json(ok({ assets }));
			}

			return c.json({ ok: false, error: `unknown tool: ${tool}` }, 400);
		} catch (e) {
			return c.json(err(e), 500);
		}
	});
}
