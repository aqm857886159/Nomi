import { describe, expect, it, vi } from "vitest";

import { spendDecisionByPolicy } from "./directGenerationBrakes";

// Worst-case decisions are checked by result and lazy-source reads, independent of CPU load.
const SHOTS = 1000;

function worstRun() {
  const ids = Array.from({ length: SHOTS }, (_, index) => `s${index}`);
  const jobs = ids.flatMap((shotId, shot) => [1, 2, 3].map((attempt) => ({
    stageId: "generate", attempt, status: "needs_attention",
    createdAt: new Date(Date.UTC(2026, 9, 12, 0, 0, attempt + (shot % 50))).toISOString(),
    metadata: { shotId },
  })));
  return { generationPlan: { shots: ids.map((shotId) => ({ shotId })) }, jobs, status: "running" } as never;
}

describe("刹车判断最坏规模", () => {
  it(`直接生成档：${SHOTS} 镜 × 3 次失败，只读一次 Run 并刹车`, () => {
    const readRun = vi.fn(() => worstRun());
    expect(spendDecisionByPolicy({ mode: "direct" }, readRun))
      .toMatchObject({ decided: false, brake: { reason: "retry-limit" } });
    expect(readRun).toHaveBeenCalledTimes(1);
  });

  it("请求批准档不读 Run：惰性来源一次都不调用", () => {
    let reads = 0;
    spendDecisionByPolicy({ mode: "request" }, () => { reads += 1; return worstRun(); });
    expect(reads).toBe(0);
  });
});
