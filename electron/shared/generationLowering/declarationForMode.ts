/**
 * 降级函数读的那份声明从哪里来（`lowerGenerationIntent.ts` 只认这个形状）。
 *
 * 有档案模式：就是这一档模式的参考槽 + `combineSlotsInto` + `fixedParams`，原样读，不猜。
 * 给了 `createBody`（主进程拿得到这条 mapping 真正渲染的 body）时多守一条：模式声明了合并键、
 * body 却根本不读它 → 合并发不出去 → 各槽留在自己的键上（`combineChannelForBody`，与 Run 路入口同一个判据）。
 * 渲染层拿不到 body，按模式声明合并；内置 body 都读自己的合并键，两边结果相同（官方字段矩阵逐格核）。
 */
import type { ArchetypeMode } from "../videoCapabilities/types";
import { combineChannelForBody, combineChannelForMode, slotJoinsCombine } from "../videoCapabilities/referenceChannels";
import type { GenerationDeclaration } from "./lowerGenerationIntent";

type ModeDeclarationShape = Pick<ArchetypeMode, "slots" | "combineSlotsInto" | "fixedParams">;

export function declarationForMode(mode: ModeDeclarationShape, createBody?: unknown): GenerationDeclaration {
  const combine = createBody === undefined ? combineChannelForMode(mode) : combineChannelForBody(mode, createBody);
  return {
    slots: mode.slots,
    combine,
    joinsCombine: mode.slots.map((slot) => Boolean(combine) && slotJoinsCombine(mode, slot)),
    ...(mode.fixedParams ? { fixedParams: mode.fixedParams } : {}),
  };
}
