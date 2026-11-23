// `draft_shots` 的回执里「这份草稿到底有没有落到画布上」这一格——宿主写、回执读，形状只有这一份。
//
// 为什么存在：草稿落画布是宿主的另一条旁路（`productionGenerationOperationStore` 的 `onPlanChanged` →
// `canvasLandingHost.landDraftOnCanvas`）：画布 Agent 的草稿每次改动都当场落成节点，文稿来源的草稿不落
// （要用户点「放入画布」），项目没开着也不落。回执原先是一句写死的话，模型照着它对用户说反话
// （节点明明建好了，却说「画布上还没有节点」）。现在回执只渲染这一格——落没落、落成哪几个节点，
// 都来自落地之后读到的那份 Run 账本，不是回执自己猜。
//
// 本文件放 `draft_shots` 回执的两块共享纯投影：
//   · `draftCanvasLandingOf` / `describeDraftCanvasLanding`：宿主写、回执读的画布落地状态；
//   · `summarizeDraftedShotsForModel`：回执第 1 行置顶的「实际落成摘要」，直接问方式主人（`modeForInputs`）
//     与参数主人（`effectiveModeParams`），暴露显式值、档案默认补上的值（如 `generate_audio: true`）与未填缺口。
import { resolveModelArchetype, type ArchetypeMode } from "../modelArchetypes";
import { modeForInputs, slotCountsForMode } from "../modelArchetypes/modeForInputs";
import { effectiveModeParams } from "../modelArchetypes/modeParams";
import { referenceDemandForRole, referenceDemandsForCandidate, type ReferenceDemand } from "../canvas/edgeAdmission";
import { validateModeConstraints } from "../videoCapabilities/crossFieldConstraints";
import { modelHandleOf } from "../agentCapabilities/modelHandle";

export const DRAFT_CANVAS_LANDING_KEY = "canvasLanding";

export type DraftCanvasLanding =
  /** 草稿的镜头已有节点在画布上（`nodes` = 已绑定的；`shotCount` = 草稿一共几镜，可能多于已落的）。 */
  | Readonly<{ state: "placed"; nodes: ReadonlyArray<Readonly<{ shotId: string; nodeId: string }>>; shotCount: number }>
  /**
   * 没落到画布：
   *   · `document_plan` 文稿来源的方案，等用户在方案行上点「放入画布」；
   *   · `project_closed` 项目此刻没开着，下次打开时才补落；
   *   · `not_landed` 项目开着、本该落，但这一次没落成（渲染层没接住）——不知道原因，不替它编。
   */
  | Readonly<{ state: "not_placed"; reason: "document_plan" | "project_closed" | "not_landed" }>;

export function draftCanvasLandingOf(result: unknown): DraftCanvasLanding | undefined {
  if (!result || typeof result !== "object") return undefined;
  const value = (result as Record<string, unknown>)[DRAFT_CANVAS_LANDING_KEY];
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.state === "not_placed") {
    return record.reason === "document_plan" || record.reason === "project_closed" || record.reason === "not_landed"
      ? { state: "not_placed", reason: record.reason } : undefined;
  }
  if (record.state !== "placed" || !Array.isArray(record.nodes) || typeof record.shotCount !== "number") return undefined;
  const nodes = record.nodes.flatMap((entry) => {
    const node = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return typeof node.shotId === "string" && typeof node.nodeId === "string" ? [{ shotId: node.shotId, nodeId: node.nodeId }] : [];
  });
  return { state: "placed", nodes, shotCount: record.shotCount };
}

/** 给模型转述的一句话（英文，对模型说、带下一步）。`undefined` = 宿主没报落地结果，回执就不提画布。 */
export function describeDraftCanvasLanding(landing: DraftCanvasLanding | undefined): string | undefined {
  if (!landing) return undefined;
  if (landing.state === "placed") {
    const ids = landing.nodes.map((node) => node.nodeId).join(", ");
    const partial = landing.nodes.length < landing.shotCount
      ? ` Only ${landing.nodes.length} of the ${landing.shotCount} shots have a node so far; do not claim the rest are on the canvas.`
      : "";
    return `The draft is saved AND is already on the canvas: ${landing.nodes.length} node${landing.nodes.length === 1 ? "" : "s"} exist for it now (${ids}) and the user can see them. Nothing was generated and nothing was spent. Do not tell the user the canvas has no nodes, and do not create the same nodes again with canvas tools; edit the draft with draft_shots and the nodes follow.${partial}`;
  }
  if (landing.reason === "document_plan") {
    return "The draft is saved as a plan on the user's document and is NOT on the canvas: the user places it with \"Place on canvas\" on that plan. Nothing was generated and nothing was spent. Do not say canvas nodes exist for it.";
  }
  if (landing.reason === "project_closed") {
    return "The draft is saved in the project but the project is not open right now, so it is NOT on the canvas yet; it appears when the user opens the project. Nothing was generated and nothing was spent. Do not say canvas nodes exist for it.";
  }
  return "The draft is saved in the project, but placing it on the canvas did not complete, so you cannot say the nodes exist. Nothing was generated and nothing was spent. Check with look_at_canvas before telling the user what is on the canvas.";
}

type DraftCandidateLike = Readonly<{
  candidateId?: string;
  providerId: string;
  modelId: string;
  variantId?: string;
  modeId?: string;
  mode?: string;
  prompt?: string;
  parameters?: Record<string, unknown>;
  references?: ReadonlyArray<Readonly<{ kind?: "image" | "video" | "audio"; role?: string }>>;
}>;

type DraftShotLike = Readonly<{
  shotId: string;
  title?: string;
  role?: string;
  candidate: DraftCandidateLike;
  storyboard?: Readonly<{ carrier?: string; anchorIds?: readonly string[] }>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asDraftCandidate(value: unknown): DraftCandidateLike | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = typeof value.providerId === "string" ? value.providerId.trim() : "";
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  if (!providerId || !modelId) return undefined;
  return {
    ...(typeof value.candidateId === "string" ? { candidateId: value.candidateId } : {}),
    providerId,
    modelId,
    ...(typeof value.variantId === "string" && value.variantId.trim() ? { variantId: value.variantId.trim() } : {}),
    ...(typeof value.modeId === "string" && value.modeId.trim() ? { modeId: value.modeId.trim() } : {}),
    ...(typeof value.mode === "string" && value.mode.trim() ? { mode: value.mode.trim() } : {}),
    ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
    ...(isRecord(value.parameters) ? { parameters: value.parameters } : {}),
    ...(Array.isArray(value.references) ? { references: value.references as DraftCandidateLike["references"] } : {}),
  };
}

function draftShotsFromResult(result: unknown): DraftShotLike[] {
  const record = isRecord(result) ? result : undefined;
  const container = record && isRecord(record.drafted) ? record.drafted : record;
  const operation = container && isRecord(container.operation) ? container.operation : undefined;
  if (!operation) return [];
  if (Array.isArray(operation.shots) && operation.shots.length > 0) {
    const out: DraftShotLike[] = [];
    for (const [index, entry] of operation.shots.entries()) {
      if (!isRecord(entry)) continue;
      const candidate = asDraftCandidate(entry.candidate);
      if (!candidate) continue;
      const shotId = typeof entry.shotId === "string" && entry.shotId.trim() ? entry.shotId.trim() : `shot-${index + 1}`;
      out.push({
        shotId,
        ...(typeof entry.title === "string" && entry.title.trim() ? { title: entry.title.trim() } : {}),
        ...(typeof entry.role === "string" ? { role: entry.role } : {}),
        candidate,
        ...(isRecord(entry.storyboard) ? { storyboard: entry.storyboard as DraftShotLike["storyboard"] } : {}),
      });
    }
    return out;
  }
  const single = asDraftCandidate(operation.candidate);
  return single ? [{ shotId: single.candidateId ?? "shot-1", candidate: single }] : [];
}

function formatParamPairs(entries: ReadonlyArray<readonly [string, unknown]>): string {
  return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ");
}

function shortQuote(shot: DraftShotLike): string {
  const raw = (shot.title || shot.candidate.prompt || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const clipped = raw.length > 36 ? `${raw.slice(0, 35)}…` : raw;
  return ` "${clipped}"`;
}

function missingSlotText(mode: ArchetypeMode, effective: Record<string, unknown>, counts: ReturnType<typeof slotCountsForMode>): string {
  const violation = validateModeConstraints(mode, effective, counts);
  if (violation && (violation.kind === "slotMissing" || violation.kind === "companionMissing" || violation.kind === "optionNeedsSlot")) {
    const slot = mode.slots.find((item) => item.kind === violation.slot);
    return slot?.label ? `${slot.label} (${violation.slot})` : violation.slot;
  }
  const required = mode.slots.filter((slot) => slot.min > 0).map((slot) => (slot.label ? `${slot.label} (${slot.kind})` : slot.kind));
  return required.length ? required.join(", ") : "required reference input";
}

function anchorDemandsForDraftShot(shot: DraftShotLike, allShots: readonly DraftShotLike[]): ReferenceDemand[] {
  const anchorIds = shot.storyboard?.anchorIds;
  if (!Array.isArray(anchorIds) || anchorIds.length === 0) return [];
  const anchors = new Map(allShots.filter((item) => item.role === "anchor").map((item) => [item.shotId, item] as const));
  const demands: ReferenceDemand[] = [];
  for (const id of anchorIds) {
    const anchor = anchors.get(id);
    if (!anchor || anchor.storyboard?.carrier === "text") continue;
    const mode = (anchor.candidate.mode ?? "").toLowerCase();
    const asset = mode.includes("audio") ? "audio" : mode.includes("video") ? "video" : "image";
    demands.push(referenceDemandForRole(undefined, asset));
  }
  return demands;
}

/**
 * 给模型看的 `draft_shots` 回执置顶第 1 段：按保存的草稿逐镜写出有效值（方式、参考件数/槽位、
 * 显式传的值、档案补上的默认值、以及纯图生空卡的 `NEEDS_INPUT` 缺口）。
 * 标题依宿主确认的逐镜节点映射，只有每镜均有节点时才称已落地。
 * 严格复用 `modeForInputs` + `slotCountsForMode` + `effectiveModeParams` + `validateModeConstraints`，不另算一份。
 */
export function summarizeDraftedShotsForModel(result: unknown): string | undefined {
  const shots = draftShotsFromResult(result);
  if (shots.length === 0) return undefined;
  const landing = draftCanvasLandingOf(result);
  const nodeByShot = new Map(landing?.state === "placed" ? landing.nodes.map((node) => [node.shotId, node.nodeId] as const) : []);
  const lines = shots.map((shot, index) => {
    const { candidate } = shot;
    const label = shot.role === "anchor" ? `Anchor ${index + 1}` : `Shot ${index + 1}`;
    const targetId = nodeByShot.get(shot.shotId) ?? shot.shotId;
    const handle = modelHandleOf({ vendor: candidate.providerId, modelId: candidate.modelId });
    const modelHandle = candidate.variantId ? `${handle} (variant=${candidate.variantId})` : handle;
    const stored = candidate.parameters ?? {};
    const refs = candidate.references ?? [];
    const anchorDemands = anchorDemandsForDraftShot(shot, shots);
    const demands = [...referenceDemandsForCandidate(refs), ...anchorDemands];
    const archetype = resolveModelArchetype(
      { modelKey: candidate.modelId, vendorKey: candidate.providerId },
      { variant: { variantId: candidate.variantId, modelId: candidate.modelId } },
    );
    if (!archetype) {
      const explicitEntries = Object.entries(stored).filter(([, value]) => value !== undefined);
      const refText = refs.length === 0 ? "references=0 (none attached)" : `references=${refs.length}`;
      return `- ${label}${shortQuote(shot)} (${targetId}): model=${modelHandle}, mode=${candidate.modeId ?? candidate.mode ?? "unknown"}, ${refText}, explicitParams={${formatParamPairs(explicitEntries)}}`;
    }
    const modeResult = modeForInputs(
      archetype,
      demands,
      candidate.modeId ? { modeId: candidate.modeId, chosenBy: "unknown" } : null,
    );
    const effectiveMode = modeResult.mode;
    const counts = slotCountsForMode(effectiveMode, demands);
    const { params: effectiveParams } = effectiveModeParams({
      archetype,
      variantId: candidate.variantId,
      modeId: effectiveMode.id,
      stored,
    });
    const explicitEntries: Array<readonly [string, unknown]> = [];
    const defaultedEntries: Array<readonly [string, unknown]> = [];
    for (const [key, value] of Object.entries(effectiveParams)) {
      if (stored[key] !== undefined) explicitEntries.push([key, value]);
      else defaultedEntries.push([key, value]);
    }
    const slotBreakdown = Object.entries(counts)
      .filter(([, count]) => typeof count === "number" && count > 0)
      .map(([kind, count]) => `${kind}:${count}`)
      .join(", ");
    const totalRefs = refs.length + anchorDemands.length;
    const refText = totalRefs === 0
      ? "references=0 (none attached)"
      : slotBreakdown
        ? `references=${totalRefs} (${slotBreakdown})`
        : `references=${totalRefs}`;
    const needsInput = modeResult.status === "needsInput"
      ? `, NEEDS_INPUT: missing required ${missingSlotText(effectiveMode, effectiveParams, counts)} before generation`
      : "";
    return `- ${label}${shortQuote(shot)} (${targetId}): model=${modelHandle}, effectiveMode=${effectiveMode.id} (${effectiveMode.vendorTerm}), ${refText}, explicitParams={${formatParamPairs(explicitEntries)}}, defaultedParams={${formatParamPairs(defaultedEntries)}}${needsInput}`;
  });
  const heading = shots.every((shot) => nodeByShot.has(shot.shotId))
    ? "Landed draft summary (effective values from the saved draft):"
    : "Saved draft summary (effective values from the saved draft):";
  return [heading, ...lines].join("\n");
}
