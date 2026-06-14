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

/**
 * 从画布节点的生成产物（result.url / result.thumbnailUrl）派生项目封面 url（最多 max 个）。
 *
 * 单一来源关系（P4 / 缩略图唯一真相源）：本函数（连同 extractThumbnailUrlsFromRaw）是
 * 缩略图派生的**算法真相源**；主进程侧 `electron/workspace/workspaceRepository.ts` 的
 * `deriveThumbnailUrls` 是同一逻辑的 main 副本（桌面 list 不经渲染层、直接读 manifest 派生封面）。
 * 两份分属 electron(CJS, rootDir=electron/) 与 renderer(ESM, src/)，跨 tsconfig 无法直接
 * import 共享一个纯模块，故以「逻辑等价 + 注释锚定 + 等价回归测试」收口：
 * `electron/workspace/thumbnailDerive.equivalence.test.ts` 用同一组 fixture 跑两份并断言输出
 * 逐字相等，任一侧改动漂移即红。规则不变：取前若干「有产物」节点、过滤过短 url（length <= 4）、
 * 对脏数据健壮降级。改本函数务必同步 main 侧 + 跑等价测试。
 *
 * 无产物降级：示例项目 / 空项目 / 脏节点时返回明确的空标记 `[]`——这是给 UI 的
 * 「此项目暂无封面，请用占位（thumbStyle 渐变 / 空 mosaic）」信号，而不是抛错或返回脏值。
 */
export function extractCanvasThumbnailUrls(
    nodes: GenerationCanvasNode[],
    max = 4,
): string[] {
    // 降级：非数组（undefined / null / 残缺记录）→ 空标记，不崩。与 main 侧 Array.isArray 守卫等价。
    if (!Array.isArray(nodes)) return [];
    const urls: string[] = [];
    for (const node of nodes) {
        if (urls.length >= max) break;
        // 脏数据健壮：数组里混入 null / 非对象节点时跳过，不读 .result 触发崩溃。
        if (!node || typeof node !== "object") continue;
        const result = (node as GenerationCanvasNode).result;
        const url = result?.url || result?.thumbnailUrl;
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
        ...(typeof raw.seedKey === "string" && raw.seedKey.trim()
            ? { seedKey: raw.seedKey.trim() }
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
        // P0-6:分镜方案随项目持久化(normalizePayload 是字段重建式,不透传 → 必须显式带上,否则切项目/重载丢)。
        storyboardPlan: payload.storyboardPlan ?? null,
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
