// 提升（promote）时写进模型 meta.adapter 的那份档案。抽出来是因为 service.ts 撞到 800 行门岗
// （R9/R12），而这本就是个纯函数：给旧 meta + 本轮结果，算出新 meta，不碰 IO。
import type { AdapterModelDraft, AdapterModeResult } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function adapterModelMetadataForPromotion(input: {
  oldMeta: Record<string, unknown>;
  candidate: AdapterModelDraft;
  modeResults: AdapterModeResult[];
  runId: string;
  revisionId: string;
  updatedAt: string;
}): Record<string, unknown> {
  const verifiedModes = input.modeResults.filter((mode) => mode.state === "verified");
  const failedModes = input.modeResults.filter((mode) => mode.state === "failed");
  const oldAdapter = asRecord(input.oldMeta.adapter);
  const oldActiveRevision = typeof oldAdapter.activeRevision === "string" ? oldAdapter.activeRevision : undefined;
  if (verifiedModes.length === 0) {
    return {
      ...input.oldMeta,
      adapter: {
        state: "failed",
        runId: input.runId,
        ...(oldActiveRevision ? { activeRevision: oldActiveRevision } : {}),
        modes: input.modeResults,
        updatedAt: input.updatedAt,
      },
    };
  }

  const oldImageOptions = asRecord(input.oldMeta.imageOptions);
  const newlyVerifiedReference = verifiedModes.some((mode) => mode.taskKind === "image_edit");
  return {
    ...input.oldMeta,
    ...(input.candidate.parameters ? { parameters: input.candidate.parameters } : {}),
    ...(input.candidate.kind === "image"
      ? {
          imageOptions: {
            ...oldImageOptions,
            supportsReferenceImages: newlyVerifiedReference || oldImageOptions.supportsReferenceImages === true,
          },
        }
      : {}),
    adapter: {
      state: failedModes.length > 0 ? "partial" : "verified",
      runId: input.runId,
      activeRevision: input.revisionId,
      /**
       * **这次发布凭的是什么**（2026-09-11）。付费验证删掉之后，发布的凭据是一次免费自检
       * （鉴权 + 模型清单 + 说明卡形状），而不是「真的出过一次片」。界面据此如实标「未试跑」——
       * 这是 D4 诚实交付：我们证明了地址和形状对，没证明它一定能出片。
       *
       * 老装机上由真实付费生成认证过的行**没有**这个字段，因此不会被误标——判据是「有没有这个
       * 印记」，不是「adapter 在不在」。第一次真实生成就是试跑。
       */
      evidence: "self-check",
      modes: input.modeResults,
      updatedAt: input.updatedAt,
    },
  };
}
