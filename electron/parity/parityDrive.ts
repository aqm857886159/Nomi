/**
 * 把「一个入口 × 一个用例」变成一条出站记录。
 *
 * 每个入口**只在这里**保留它自己那一段预处理（提示词最终投影、重试指令、参数怎么进请求），
 * 其余一律走真实生产函数。入口之间的差异因此只可能来自生产代码，不可能来自夹具。
 */
import { projectPromptForSend } from "../shared/storyboard/promptMentions";
import type { GenerationEntrance } from "./generationEntrances";
import type { ParityCase } from "./parityCases";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { driveEngineA, driveEngineB, driveEngineCanvasRun, type FetchCapture } from "./generationParityTestUtils";
import type { OutboundRecord } from "./outboundRecord";

/** 审片定向重试那一句（`catalogTaskActions.ts` 的 `promptSuffix`，内容由审片器给，形状固定）。 */
export const RETRY_DIRECTIVE = "上一版人物朝向错了，这次让人物面向镜头。";

const nodeKindForTaskKind = (taskKind: string): string =>
  taskKind.includes("video") ? "video" : taskKind.includes("audio") ? "audio" : "image";

function referenceRecords(urls: readonly string[]): Array<{ assetId: string; contentHash: string; version: number; kind: "image" }> {
  return urls.map((url, index) => ({
    assetId: url,
    contentHash: `parity-hash-${index}`,
    version: 1,
    kind: "image" as const,
  }));
}

export async function driveEntrance(
  capture: FetchCapture,
  entrance: GenerationEntrance,
  testCase: ParityCase,
): Promise<OutboundRecord> {
  const references = testCase.referenceUrls ?? [];
  if (entrance.engine === "runtime" || entrance.engine === "canvas-run") {
    const projected = entrance.projectsPromptMentions
      ? projectPromptForSend(testCase.prompt, references)
      : testCase.prompt;
    const prompt = entrance.appendsRetryDirective ? `${projected}\n\n${RETRY_DIRECTIVE}` : projected;
    return (entrance.engine === "canvas-run" ? driveEngineCanvasRun : driveEngineA)(capture, {
      vendorKey: testCase.vendorKey,
      kind: testCase.taskKind,
      prompt,
      extras: {
        ...testCase.parameters,
        modelKey: testCase.modelKey,
        modelAlias: testCase.modelKey,
        projectId: "parity-project",
        nodeId: "parity-node",
        nodeKind: nodeKindForTaskKind(testCase.taskKind),
        ...(references.length ? { referenceImages: [...references] } : {}),
      },
    });
  }
  const prompt = entrance.appendsRetryDirective ? `${testCase.prompt}\n\n${RETRY_DIRECTIVE}` : testCase.prompt;
  const records = referenceRecords(references);
  return driveEngineB(capture, {
    vendorKey: testCase.vendorKey,
    modelId: testCase.modelKey,
    mode: testCase.taskKind,
    prompt,
    parameters: testCase.parameters,
    references: records,
    ...(records.length
      ? { referenceUrls: Object.fromEntries(records.map((record) => [spendReferenceKey(record), record.assetId])) }
      : {}),
  });
}
