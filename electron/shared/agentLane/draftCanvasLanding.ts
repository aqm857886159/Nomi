// `draft_shots` 的回执里「这份草稿到底有没有落到画布上」这一格——宿主写、回执读，形状只有这一份。
//
// 为什么存在：草稿落画布是宿主的另一条旁路（`productionGenerationOperationStore` 的 `onPlanChanged` →
// `canvasLandingHost.landDraftOnCanvas`）：画布 Agent 的草稿每次改动都当场落成节点，文稿来源的草稿不落
// （要用户点「放入画布」），项目没开着也不落。回执原先是一句写死的话，模型照着它对用户说反话
// （节点明明建好了，却说「画布上还没有节点」）。现在回执只渲染这一格——落没落、落成哪几个节点，
// 都来自落地之后读到的那份 Run 账本，不是回执自己猜。
//
// 本文件没有运行时依赖：主进程的适配器写它，回执渲染读它。

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
