import { assertProjectAgentBinding, type ProjectBinding } from "../projectBinding";

/**
 * 主进程 → 渲染层：交给主进程观察者的那一笔画布单镜收尾了（出片或失败），去按这一次自己的运行记录号收。
 * 渲染层收它和收自己等到的结局走同一本账（按号进这一镜的运行记录；比它新的已成功就只进版本历史）。
 * 项目身份是这一笔提交时的那个项目，不是此刻打开的项目：不在前台就写进它的盘上副本。
 */
export const CANVAS_SHOT_SETTLED_OP = "canvas.run-settled";

export type CanvasShotSettledNotice = ProjectBinding & Readonly<{ nodeId: string; runRecordId: string }>;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** 认不得的一律拒（抛错）：主进程据此当作没接住，下次打开项目再摇。 */
export function parseCanvasShotSettledNotice(payload: unknown): CanvasShotSettledNotice {
  const data = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const binding = {
    projectId: data.projectId,
    immutableProjectUuid: data.immutableProjectUuid,
    projectGeneration: data.projectGeneration,
  } as ProjectBinding;
  assertProjectAgentBinding(binding);
  const nodeId = text(data.nodeId);
  const runRecordId = text(data.runRecordId);
  if (!nodeId || !runRecordId) throw new Error("canvas_run_settled_invalid");
  return { ...binding, nodeId, runRecordId };
}
