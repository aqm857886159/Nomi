import { describe, expect, it } from "vitest";
import type { PlanShot, StoryboardPlan } from "../../generationCanvas/agent/storyboardPlan";
import type { GenerationResolvePlanEnvelope } from "../../../../electron/shared/videoCapabilities/planResolutionContracts";
import {
  fetchStoryboardResolve,
  resolveGeneratableGate,
  storyboardResolveRequest,
  type StoryboardResolveClient,
} from "./strategyGate";

const shot = (partial: Partial<PlanShot> & { index: number; durationSec: number; prompt: string }): PlanShot => ({
  shotKind: "video",
  sceneId: "scene-1",
  anchorIds: [],
  ...partial,
} as PlanShot);

const plan = (shots: PlanShot[]): StoryboardPlan => ({
  title: "t",
  anchors: [],
  shots,
  scenes: [{ id: "scene-1", title: "雨夜巷口" }],
});

const videoPlan = plan([
  shot({ index: 1, shotId: "s1", durationSec: 40, prompt: "长镜" }),
  shot({ index: 2, shotId: "s2", durationSec: 4, prompt: "B" }),
]);

const imageOnlyPlan = plan([shot({ index: 1, shotKind: "image", durationSec: 0, prompt: "still" })]);

const okValue = {
  resolvedShots: [
    {
      id: "s1", modelKey: "m", modeId: "text", modeLabel: "文生视频", durationMin: 5, durationMax: 15,
      params: {}, issues: [],
    },
  ],
  mergeProposals: [],
  splitProposals: [
    { shotId: "s1", durationSec: 40, pieces: [{ durationSec: 15 }, { durationSec: 15 }, { durationSec: 10 }], suggestFirstLast: true, reason: "s1 超上限拆 15+15+10" },
  ],
  planIssues: [],
} as const;

const client = (reply: GenerationResolvePlanEnvelope | Error): StoryboardResolveClient => ({
  resolvePlan: async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  },
});

describe("strategyGate · 请求投影", () => {
  it("只有视频镜头才投影；全 image 方案 → null（不查）", () => {
    expect(storyboardResolveRequest(imageOnlyPlan, "p-1")).toBeNull();
    const request = storyboardResolveRequest(videoPlan, "p-1");
    expect(request).not.toBeNull();
    expect(request!.projectId).toBe("p-1");
    expect(request!.shots.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

describe("strategyGate · fetch / gate", () => {
  it("fetch 返回 envelope 原文；无 client / 无 projectId / client 抛错 → null（fail-open）", async () => {
    const envelope: GenerationResolvePlanEnvelope = { ok: true, value: okValue as never };
    await expect(fetchStoryboardResolve(videoPlan, "p-1", client(envelope))).resolves.toEqual(envelope);
    await expect(fetchStoryboardResolve(videoPlan, null, client(envelope))).resolves.toBeNull();
    await expect(fetchStoryboardResolve(videoPlan, "p-1", null)).resolves.toBeNull();
    await expect(fetchStoryboardResolve(videoPlan, "p-1", client(new Error("boom")))).resolves.toBeNull();
  });

  it("gate：有阻断（拆条/必须合并/blocker）→ 返回第一条机器理由；纯建议式合并 → null", async () => {
    const blocked: GenerationResolvePlanEnvelope = { ok: true, value: okValue as never };
    await expect(resolveGeneratableGate(videoPlan, "p-1", client(blocked))).resolves.toBe("s1 超上限拆 15+15+10");

    const advisoryOnly: GenerationResolvePlanEnvelope = {
      ok: true,
      value: {
        ...okValue,
        splitProposals: [],
        mergeProposals: [{
          id: "m1", shotIds: ["s1", "s2"], durationSec: 10, modelKey: "m", modeId: "text", modeLabel: "文生视频",
          advisory: true, reason: "效率合并",
        }],
      } as never,
    };
    await expect(resolveGeneratableGate(videoPlan, "p-1", client(advisoryOnly))).resolves.toBeNull();
  });

  it("gate：envelope 错误（能力核未起/其它）→ fail-open 放行", async () => {
    const errorReply: GenerationResolvePlanEnvelope = {
      ok: false,
      error: { code: "generation_core_unavailable", message: "未就绪" },
    };
    await expect(resolveGeneratableGate(videoPlan, "p-1", client(errorReply))).resolves.toBeNull();
  });

  it("无视频镜头或 image-only → gate 恒放行", async () => {
    const blocked: GenerationResolvePlanEnvelope = { ok: true, value: okValue as never };
    await expect(resolveGeneratableGate(imageOnlyPlan, "p-1", client(blocked))).resolves.toBeNull();
  });
});
