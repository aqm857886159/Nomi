// 动词参数 → 契约语义输入的**唯一对应表**（两个 profile 共用）。
//
// 模型填的是动词自己的字段（`write_script` 的 `where`、`arrange_canvas` 的 `links`），契约执行层认的是
// 语义输入（`document.write` 的 `operation`、`canvas.write` 的 `operation` 分支）。翻译住在声明上
// （`VerbDeclaration.semanticInputOf`），`toSemanticInput` 是唯一调用点：内部 lane 的 prepare 与对外 MCP 的
// `parseDerivedCall` 都从它拿契约输入——#777 曾只给 lane 翻，于是对外 `nomi_document_edit` 收到 `where` 就
// `capability_input_invalid`。返回值再过一次契约 parse，跨字段约束（连边至少一条等）照旧生效。
import { ASSET_READ_ALIASES, type AssetReadInput } from "../assetRead";
import { canvasWriteSemanticInputSchema, type CanvasWriteInput } from "../canvasWrite";
import type { DocumentWriteInput } from "../documentWrite";
import { TIMELINE_READ_ALIASES, type TimelineReadInput } from "../timelineRead";

/** `read_timeline` 参数 → 契约语义输入。范围齐全才是 range 读；只给一半按契约的跨字段约束拒。 */
export function timelineReadInputOf(args: unknown): TimelineReadInput {
  const { startFrame, endFrame } = args as { startFrame?: number; endFrame?: number };
  if (startFrame === undefined && endFrame === undefined) return { operation: TIMELINE_READ_ALIASES.read } as TimelineReadInput;
  return { operation: TIMELINE_READ_ALIASES.inspectRange, startFrame: startFrame ?? 0, endFrame: endFrame ?? 0 } as TimelineReadInput;
}

/**
 * `look_at_media` 五合一（拍板一.3）→ 契约的五个方法之一，按参数形状派生：
 * `waveform` → read_waveform；`startFrame`/`endFrame` → inspect_source_range；只有 `assetId` → inspect_media
 * （记录 + 技术事实）；其余 → search_media。方法名从 `ASSET_READ_ALIASES` 取，不在这里手写。
 */
export function assetReadInputOf(args: unknown): AssetReadInput {
  const { query, kinds, limit, assetId, startFrame, endFrame, waveform } = args as {
    query?: string; kinds?: string[]; limit?: number; assetId?: string; startFrame?: number; endFrame?: number;
    waveform?: { startSeconds?: number; endSeconds?: number; buckets?: number };
  };
  if (assetId && waveform) return { operation: ASSET_READ_ALIASES.waveform, assetId, ...waveform } as AssetReadInput;
  if (assetId && (startFrame !== undefined || endFrame !== undefined)) {
    return { operation: ASSET_READ_ALIASES.inspectRange, assetId, startFrame: startFrame ?? 0, endFrame: endFrame ?? 0 } as AssetReadInput;
  }
  if (assetId) return { operation: ASSET_READ_ALIASES.inspect, assetId } as AssetReadInput;
  return {
    operation: ASSET_READ_ALIASES.search,
    ...(query !== undefined ? { query } : {}), ...(kinds ? { kinds } : {}), ...(limit !== undefined ? { limit } : {}),
  } as AssetReadInput;
}

/** `write_script.where` → `document.write.operation`。三个 `where` 是同一格里的三个分支（拍板一.3）。 */
export const DOCUMENT_WRITE_OPERATION_BY_WHERE = Object.freeze({
  cursor: "insert",
  selection: "replace",
  end: "append",
} as const);

export function documentWriteInputOf(args: unknown): DocumentWriteInput {
  const { content, where } = args as { content: string; where: keyof typeof DOCUMENT_WRITE_OPERATION_BY_WHERE };
  return { operation: DOCUMENT_WRITE_OPERATION_BY_WHERE[where], content };
}

type ArrangeArgs = { links?: Array<{ fromId: string; toId: string; role?: string }>; tidy?: boolean; categoryId?: string };
type ArtifactArgs = { fileType: string; title: string; content: string };
type StageArgs = { shotId: string; staging?: Record<string, unknown>; cameraMove?: Record<string, unknown> };

/**
 * 三个画布写动词 → `canvas.write` 的语义输入。只认这三个名字：退役的旧名（`nomi_canvas_write` /
 * `nomi_storyboard_write` …）**不在这里兼容**，旧转录里的那些调用只是历史消息（拍板二.4：不留安全阀门）。
 */
export function canvasWriteInputOf(verb: string, args: unknown): CanvasWriteInput {
  let semantic: unknown;
  if (verb === "arrange_canvas") {
    const { links, tidy, categoryId } = args as ArrangeArgs;
    if (links && links.length > 0) {
      semantic = { operation: "connect_canvas_edges", edges: links.map((link) => ({ sourceClientId: link.fromId, targetClientId: link.toId, ...(link.role ? { mode: link.role } : {}) })) };
    } else if (tidy) {
      semantic = { operation: "tidy_canvas", ...(categoryId ? { categoryId } : {}) };
    } else {
      throw new Error("arrange_canvas needs links to connect or tidy: true");
    }
  } else if (verb === "make_artifact") {
    const { fileType, title, content } = args as ArtifactArgs;
    semantic = {
      operation: "create_canvas_nodes", summary: title,
      nodes: [{ clientId: "artifact-1", kind: "agent-artifact", title, prompt: "", artifact: { fileType, content } }],
    };
  } else if (verb === "stage_shot") {
    const { shotId, staging, cameraMove } = args as StageArgs;
    semantic = staging
      ? { operation: "create_staging_reference", shotClientId: shotId, ...staging }
      : { operation: "create_camera_move", shotClientId: shotId, ...cameraMove };
  } else {
    throw new Error(`Unregistered canvas verb: ${verb}`);
  }
  return canvasWriteSemanticInputSchema.parse(semantic);
}
