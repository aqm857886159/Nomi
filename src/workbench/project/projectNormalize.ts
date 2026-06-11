import { normalizeTimeline } from "../timeline/timelineMath";
import { normalizeWorkbenchDocument } from "../workbenchPersistence";
import {
    createDefaultWorkbenchProjectPayload,
    workbenchProjectPayloadSchema,
    workbenchProjectRecordSchema,
    type WorkbenchProjectPayload,
    type WorkbenchProjectRecordLegacy,
    type WorkbenchProjectRecordV1,
    type WorkbenchProjectSummary,
} from "./projectRecordSchema";
import type { GenerationCanvasNode } from "../generationCanvas/model/generationCanvasTypes";
import { normalizeCategories } from "./projectCategories";

export function extractCanvasThumbnailUrls(
    nodes: GenerationCanvasNode[],
    max = 4,
): string[] {
    const urls: string[] = [];
    for (const node of nodes) {
        if (urls.length >= max) break;
        const url = node.result?.url || node.result?.thumbnailUrl;
        if (typeof url === "string" && url.length > 4) urls.push(url);
    }
    return urls;
}

export function extractThumbnailUrlsFromRaw(raw: unknown): string[] {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const payload = r.payload as Record<string, unknown> | undefined;
    const gc = (payload?.generationCanvas ?? r.generationCanvas) as
        | Record<string, unknown>
        | undefined;
    const nodes = gc?.nodes;
    if (!Array.isArray(nodes)) return [];
    return extractCanvasThumbnailUrls(nodes as GenerationCanvasNode[]);
}

export function normalizeSummary(input: unknown): WorkbenchProjectSummary | null {
    if (!input || typeof input !== "object") return null;
    const raw = input as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name =
        typeof raw.name === "string" && raw.name.trim()
            ? raw.name.trim()
            : "未命名项目";
    const updatedAt =
        typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
            ? raw.updatedAt
            : Date.now();
    const createdAt =
        typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
            ? raw.createdAt
            : updatedAt;
    if (!id) return null;
    return {
        id,
        name,
        updatedAt,
        createdAt,
        ...(typeof raw.revision === "number" &&
        Number.isInteger(raw.revision) &&
        raw.revision >= 0
            ? { revision: raw.revision }
            : {}),
        ...(typeof raw.savedAt === "number" && Number.isFinite(raw.savedAt)
            ? { savedAt: raw.savedAt }
            : {}),
        ...(typeof raw.thumbStyle === "string" && raw.thumbStyle.trim()
            ? { thumbStyle: raw.thumbStyle.trim() }
            : {}),
        ...(typeof raw.thumbnail === "string" && raw.thumbnail.trim()
            ? { thumbnail: raw.thumbnail.trim() }
            : {}),
        ...(Array.isArray(raw.thumbnailUrls) && raw.thumbnailUrls.length
            ? {
                  thumbnailUrls: raw.thumbnailUrls.filter(
                      (u): u is string => typeof u === "string",
                  ),
              }
            : {}),
        ...(raw.source === "native" || raw.source === "folder"
            ? { source: raw.source }
            : {}),
        ...(typeof raw.rootPath === "string" && raw.rootPath.trim()
            ? { rootPath: raw.rootPath.trim() }
            : typeof raw.lastKnownRootPath === "string" &&
                raw.lastKnownRootPath.trim()
              ? { rootPath: raw.lastKnownRootPath.trim() }
              : {}),
        ...(typeof raw.missing === "boolean" ? { missing: raw.missing } : {}),
    };
}

function normalizeLegacyRecord(
    input: unknown,
): WorkbenchProjectRecordLegacy | null {
    if (!input || typeof input !== "object") return null;
    const raw = input as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const createdAt =
        typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
            ? raw.createdAt
            : null;
    const updatedAt =
        typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
            ? raw.updatedAt
            : null;
    if (!id || !name || createdAt == null || updatedAt == null) return null;
    return {
        id,
        name,
        createdAt,
        updatedAt,
        ...(typeof raw.thumbStyle === "string" && raw.thumbStyle.trim()
            ? { thumbStyle: raw.thumbStyle.trim() }
            : {}),
        workbenchDocument: raw.workbenchDocument,
        timeline: raw.timeline,
        generationCanvas: raw.generationCanvas,
    };
}

export function normalizePayload(input: unknown): WorkbenchProjectPayload {
    const parsed = workbenchProjectPayloadSchema.safeParse(input);
    if (!parsed.success) {
        throw new Error("本地项目记录损坏：payload 缺少必要字段");
    }
    const payload = parsed.data;
    return {
        workbenchDocument: normalizeWorkbenchDocument(
            payload.workbenchDocument,
        ),
        timeline: normalizeTimeline(payload.timeline),
        generationCanvas: payload.generationCanvas,
        categories: normalizeCategories(payload.categories),
    };
}

/**
 * True when the raw record carries any persisted creation content. A workspace
 * that was initialized by "打开文件夹" on an existing folder (but never saved)
 * has a minimal manifest payload (just `{ rootPath }`) and none of these fields.
 */
function recordHasPersistedContent(raw: unknown): boolean {
    if (!raw || typeof raw !== "object") return false;
    const rec = raw as Record<string, unknown>;
    const containers: Array<Record<string, unknown> | undefined> = [
        rec,
        rec.payload && typeof rec.payload === "object"
            ? (rec.payload as Record<string, unknown>)
            : undefined,
    ];
    return containers.some((container) =>
        Boolean(
            container &&
                (container.workbenchDocument ||
                    container.timeline ||
                    container.generationCanvas),
        ),
    );
}

export function normalizeRecord(
    summary: WorkbenchProjectSummary,
    raw: unknown,
): WorkbenchProjectRecordV1 {
    const legacyParsed = workbenchProjectRecordSchema.safeParse(raw);
    if (legacyParsed.success) {
        return {
            ...legacyParsed.data,
            payload: normalizePayload(legacyParsed.data.payload),
        };
    }
    // Freshly-initialized workspace (existing folder opened via "打开文件夹",
    // never saved): its manifest payload is minimal (just rootPath). Open it as
    // an empty project with default payload instead of throwing 记录损坏 and
    // failing to open silently.
    if (!recordHasPersistedContent(raw)) {
        return {
            ...summary,
            version: 1,
            payload: createDefaultWorkbenchProjectPayload(),
        };
    }
    const legacy = normalizeLegacyRecord(raw);
    if (!legacy) {
        throw new Error(`本地项目记录损坏：${summary.id}`);
    }
    const payload = normalizePayload(legacy);
    return {
        ...summary,
        version: 1,
        payload,
    };
}

export function createProjectRecord(
    summary: WorkbenchProjectSummary,
    payload?: Partial<WorkbenchProjectPayload>,
): WorkbenchProjectRecordV1 {
    return {
        ...summary,
        revision: summary.revision ?? 0,
        savedAt: summary.savedAt ?? summary.updatedAt,
        version: 1,
        payload: {
            ...createDefaultWorkbenchProjectPayload(),
            ...(payload || {}),
        },
    };
}

export function seedDocFromMarkdown(markdown: string): unknown {
    const lines = markdown.split(/\r?\n/);
    const blocks: Array<Record<string, unknown>> = [];
    for (const line of lines) {
        const trimmed = line.replace(/\s+$/, "");
        if (!trimmed) continue;
        if (trimmed.startsWith("# ")) {
            blocks.push({
                type: "heading",
                attrs: { level: 1 },
                content: [{ type: "text", text: trimmed.slice(2) }],
            });
        } else if (trimmed.startsWith("## ")) {
            blocks.push({
                type: "heading",
                attrs: { level: 2 },
                content: [{ type: "text", text: trimmed.slice(3) }],
            });
        } else {
            blocks.push({
                type: "paragraph",
                content: [{ type: "text", text: trimmed }],
            });
        }
    }
    return { type: "doc", content: blocks };
}
