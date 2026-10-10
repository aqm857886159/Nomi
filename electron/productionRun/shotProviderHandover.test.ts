import { describe, expect, it } from "vitest";

import type { ProductionRun } from "./productionRunTypes";
import { awaitShotHandover, shotHandoverPhase } from "./shotProviderHandover";

// 「生成剩下 N 张」一张一张交（10-09 拍板 B）：批过的这一镜交到哪一步，只读耐久 Run。
function run(status: ProductionRun["status"], job?: Partial<ProductionRun["jobs"][number]>): ProductionRun {
  return {
    status,
    generationPlan: { shots: [{ shotId: "shot-1" }] },
    jobs: job ? [{ jobId: "job-1", stageId: "generate", attempt: 1, createdAt: "2026-10-09T00:00:00.000Z", metadata: { shotId: "shot-1" }, ...job }] : [],
  } as unknown as ProductionRun;
}

describe("how far an approved shot has been handed to the provider", () => {
  it("accepted only when the provider gave a task id", () => {
    expect(shotHandoverPhase(run("running", { status: "provider_accepted", providerTaskId: "t-1" }), "shot-1")).toBe("accepted");
    expect(shotHandoverPhase(run("running", { status: "submitting" }), "shot-1")).toBe("submitting");
    expect(shotHandoverPhase(run("running", { status: "authorized" }), "shot-1")).toBe("waiting_dispatch");
    expect(shotHandoverPhase(run("running", { status: "needs_attention", errorCode: "provider_rejected" }), "shot-1")).toBe("settled_without_acceptance");
  });

  it("a stopped Run will not dispatch an approved-but-unsent shot; a shot already being submitted is let finish", () => {
    expect(shotHandoverPhase(run("needs_attention", { status: "authorized" }), "shot-1")).toBe("not_dispatched");
    expect(shotHandoverPhase(run("pausing", { status: "submitting" }), "shot-1")).toBe("submitting");
  });

  it("waits on a real clock until the handover settles; gives up honestly when dispatch never starts", async () => {
    let clock = 0;
    const states = [run("running", { status: "authorized" }), run("running", { status: "submitting" }), run("running", { status: "polling", providerTaskId: "t-1" })];
    let reads = 0;
    const accepted = await awaitShotHandover({ readRun: () => states[Math.min(reads++, states.length - 1)], shotId: "shot-1", now: () => clock, sleep: async (ms) => { clock += ms; } });
    expect(accepted).toBe("accepted");

    clock = 0;
    const never = await awaitShotHandover({ readRun: () => run("running", { status: "authorized" }), shotId: "shot-1", dispatchStartLimitMs: 1_000, now: () => clock, sleep: async (ms) => { clock += ms; } });
    expect(never).toBe("timed_out");
  });
});
