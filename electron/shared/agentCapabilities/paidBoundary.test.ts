// 付费边界只表达一次——这份测试证的是「只有一次」，不是「写对了」。
//
// 每条都带阳性对照（R17）：不先证明它会红，一条永远为真的断言和一条真的在守东西的断言
// 长得一模一样。
import { describe, expect, it } from "vitest";

import { CAPABILITY_CONTRACTS } from "./registry";
import { LANE_MODEL_TOOL_CATALOG } from "../../agentLane/laneToolCatalog";
import {
  PAID_CAPABILITY_CONTRACTS,
  assertPaidBoundaryExternalSurface,
  hostOnlyTransitions,
  isPaidBoundaryAlias,
  paidBoundaryAliases,
  paidBoundaryAnnotations,
  projectsToInternalProfile,
} from "./paidBoundary";

describe("付费边界（方案 §3.1 第二行）", () => {
  it("唯一判据是契约上的 effect:\"paid\"，今天恰好只有 generation.gate", () => {
    expect(PAID_CAPABILITY_CONTRACTS.map((contract) => contract.id)).toEqual(["generation.gate"]);
    // 阳性对照：判据真的在读契约，而不是抄了一个 id。
    expect(CAPABILITY_CONTRACTS.filter((contract) => contract.effect === "paid").map((c) => c.id))
      .toEqual(PAID_CAPABILITY_CONTRACTS.map((c) => c.id));
  });

  it("内部面：付费能力不投影，模型面根本够不着", () => {
    // 付费边界上的名字只住 `method` surface（宿主/dispatcher 方法名）；`pi` surface 上一个都没有。
    expect(paidBoundaryAliases("pi")).toEqual([]);
    for (const alias of paidBoundaryAliases("method")) {
      expect(LANE_MODEL_TOOL_CATALOG.some((tool) => tool.name === alias)).toBe(false);
    }
    // 阳性对照：这条断言不是因为「lane 目录恰好是空的」而通过。
    expect(LANE_MODEL_TOOL_CATALOG.length).toBeGreaterThan(0);
    expect(projectsToInternalProfile(PAID_CAPABILITY_CONTRACTS[0]!)).toBe(false);
    expect(projectsToInternalProfile(CAPABILITY_CONTRACTS.find((c) => c.id === "document.read")!)).toBe(true);
  });

  it("宿主独占转换的名单是算出来的，语义与 PR A 之前手写的三行逐字一致", () => {
    const transitions = hostOnlyTransitions();
    expect(transitions.map(({ name }) => name)).toEqual([
      "nomi_request_generation_gate",
      "nomi_start_generation",
      "nomi_decide_generation_gate",
    ]);
    for (const transition of transitions) {
      expect(transition.capabilityRefs).toEqual(["generation.gate"]);
      expect(transition.reason).toMatch(/never model-initiated/);
    }
  });

  it("对外面：路由到付费别名却不带 destructiveHint 的工具，装配期当场抛（阳性对照）", () => {
    const complete = [
      { name: "nomi_operation_gate", routedMethods: ["nomi_request_generation_gate", "nomi_decide_generation_gate"], annotations: paidBoundaryAnnotations() },
      { name: "nomi_operation_execute", routedMethods: ["nomi_start_generation"], annotations: paidBoundaryAnnotations() },
    ];
    expect(() => assertPaidBoundaryExternalSurface(complete)).not.toThrow();

    // ① 少带注解 → 红。这正是阶段 5a 之前这两个工具的真实状态。
    expect(() => assertPaidBoundaryExternalSurface([
      { ...complete[0]!, annotations: undefined },
      complete[1]!,
    ])).toThrow(/without destructiveHint/);

    // ② 少一个别名没人认领 → 红。这正是「加第二个付费能力却忘了对外接线」的形状。
    expect(() => assertPaidBoundaryExternalSurface([complete[0]!]))
      .toThrow(/aliases no external tool claims: nomi_start_generation/);

    // ③ 只读注解不算数——抬高摩擦才算，降低不算。
    expect(() => assertPaidBoundaryExternalSurface([
      { ...complete[0]!, annotations: { readOnlyHint: true as const } },
      complete[1]!,
    ])).toThrow(/without destructiveHint/);
  });

  it("同一个函数回答两个面的问题——这才是「只表达一次」在代码里的形状", () => {
    expect(isPaidBoundaryAlias("nomi_start_generation")).toBe(true);
    expect(isPaidBoundaryAlias("read_timeline")).toBe(false);
  });
});
