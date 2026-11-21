// 「把 Agent 那一次出价里的几镜交给画布」主进程 ↔ 渲染层那一问的**跨进程契约**（D2 第③步：一台发动机）。
//
// 主进程（`electron/capabilityCore/canvasHandOver.ts`）记好交接、落好节点之后问渲染层；渲染层
// （`src/workbench/capability/productionHandOverShotsOp.ts`）按画布批量那一条路开同意、派发，回话说哪几镜没开出同意。
// 两端各写一份 op 名 / 回话形状，迟早有一端先漂——所以住在中立契约层，谁也不拥有实现。
import type { GenerationHandOverFailure } from "../../productionRun/productionRunTypes";

export const HAND_OVER_SHOTS_OP = "production.hand-over-shots";

/** 主进程发给渲染层的那一问：这一次出价里要交出去的几镜（都已落到画布上）+ 卡上摆没摆过素材托管的披露、点的是不是人。 */
export type HandOverShotsRequest = Readonly<{
  projectId: string;
  runId: string;
  shots: ReadonlyArray<Readonly<{ shotId: string; nodeId: string }>>;
  /** 卡上摆过托管披露、用户点的就是「生成」（手势）。策略那一档恒 false：托管要问人，策略不代答。 */
}>;

/** 渲染层的回话：哪几镜没开出同意、为什么（Nomi 自己的语义码）。没提到的、也没绑上的，主进程按「没开出同意」收尾。 */
export type HandOverShotsReply = Readonly<{
  skipped?: ReadonlyArray<Readonly<{ shotId: string; failure: GenerationHandOverFailure }>>;
}>;
