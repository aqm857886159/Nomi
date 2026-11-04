// 画布传输的查询：Nomi 这一次没法去问供应商时，不能把「没问」当成这一单的结论。
// 矩阵（tests/run-retrieval-recovery）走真的查询链，同进程只走得到其中一种本机查不了；这里三种码逐个钉住。
import { describe, expect, it } from "vitest";

import { matchNomiErrorCode } from "../shared/nomiErrorCodes";
import { canvasLastResult, createCanvasTransportProvider, type CanvasTaskResult } from "./canvasTransportProvider";

const context = { modelId: "m", mode: "text_to_image", parameters: { vendor: "acme", request: { kind: "text_to_image", prompt: "x" } } };

function providerAnswering(answers: CanvasTaskResult[]) {
  let index = 0;
  const provider = createCanvasTransportProvider("acme", {
    execute: async () => { throw new Error("a query must never submit"); },
    fetchResult: async () => ({ result: answers[Math.min(index++, answers.length - 1)]! }),
  });
  return (taskId: string) => provider.query!(taskId, context);
}

describe("canvas transport query", () => {
  it.each(["task_unknown", "task_tracking_lost", "model_unresolvable"])("%s：抛带码的错误，不当结论，也不进备忘；开回来查到的是新的", async (code) => {
    const taskId = `task-${code}`;
    const blocked: CanvasTaskResult = { id: taskId, kind: "text_to_image", status: "failed", assets: [], raw: { code, taskId }, error: "cannot ask" };
    const done: CanvasTaskResult = { id: taskId, kind: "text_to_image", status: "succeeded", assets: [{ type: "image", url: "https://cdn.test/a.png" }], raw: { id: taskId } };
    const query = providerAnswering([blocked, done]);

    const thrown = await query(taskId).catch((error: unknown) => error);
    expect(matchNomiErrorCode(String((thrown as Error).message))).toBe("retrieval-unavailable");
    expect(canvasLastResult(taskId)).toBeUndefined();

    await expect(query(taskId)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("供应商真说失败：照旧是这一单的结论", async () => {
    const taskId = "task-provider-failed";
    const query = providerAnswering([{ id: taskId, kind: "text_to_image", status: "failed", assets: [], raw: { code: "content_policy" }, error: "blocked" }]);
    await expect(query(taskId)).resolves.toMatchObject({ status: "failed" });
    expect(canvasLastResult(taskId)?.error).toBe("blocked");
  });
});
