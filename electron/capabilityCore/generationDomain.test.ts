/**
 * 生成这一套的接线只有一处：再手写一份装配，交不进用到规划的位置。
 *
 * 三层各拦什么：
 *  · 直接写 → 类型检查红（下面的 `@ts-expect-error`，随 `check:test-types` 跑）；
 *  · 加 `as` 强转骗过类型 → 装上 / 用到的那一刻按名单抛错（下面的运行时用例）；
 *  · 特意去调测试发放口 → 只有测试 setup 文件打开过才发得出来，没打开就抛错。
 */
import { describe, expect, it, vi } from "vitest";

import { dispatch } from "./dispatcher";
import { withFixedCatalog } from "./generationFixedCatalog.testkit";
import { createGenerationDomain, type GenerationHostPorts, type IssuedGenerationPlanning } from "./generationDomain";
import { issueGenerationPlanningForTest } from "./generationPlanningIssue";
import { installGuiResolveNarrowIpc } from "./generationResolveIpc";
import { createPiGenerationTransportAdapter } from "./generationTransportAdapters";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "./mcpGenerationTools";
import { createModuleRegistry } from "./moduleRegistry";
import { installResidentGenerationAdapter } from "./residentGenerationAdapterFactory";
import { createRunOwnedGenerationGateAuthority } from "./runOwnedGenerationGateAuthority";

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined } };
});

/** 第三个文件里手写的一份装配：拿一张模型表直接搭规划逻辑。 */
function handWrittenPlanning() {
  return createGenerationPlanningHandler(withFixedCatalog({
    registry: createModuleRegistry([]),
    operations: createInMemoryGenerationOperationStore(),
  }));
}

describe("手写的规划交不进用到规划的位置", () => {
  it("强转骗过类型：五个位置在装上 / 用到的那一刻都抛错", async () => {
    const forged = handWrittenPlanning() as unknown as IssuedGenerationPlanning;
    const refused = /generation_planning_not_issued/;

    expect(() => createRunOwnedGenerationGateAuthority({ owner: {} as never, operations: {} as never, planning: forged, receipts: {} as never })).toThrow(refused);
    expect(() => installGuiResolveNarrowIpc(forged)).toThrow(refused);
    expect(() => installResidentGenerationAdapter({ planning: forged } as never)).toThrow(refused);
    expect(() => createPiGenerationTransportAdapter({ projectId: "p", immutableProjectUuid: "u", projectGeneration: 1 }, { planning: forged, leaseFor: () => ({}) as never })).toThrow(refused);
    await expect(dispatch("nomi_operation_read", { operationId: "op-1" }, { origin: { host: "codex" }, generationPlanning: forged } as never)).rejects.toThrow(refused);
  });

  it("不该拦的：测试的桩经测试发放口进名单，装得上", () => {
    const stub = issueGenerationPlanningForTest(async () => ({}));
    expect(() => createPiGenerationTransportAdapter({ projectId: "p", immutableProjectUuid: "u", projectGeneration: 1 }, { planning: stub, leaseFor: () => ({}) as never })).not.toThrow();
  });

  it("测试发放口没被 setup 打开时一调就抛错（生产里没有人打开它）", async () => {
    vi.resetModules();
    // eslint-disable-next-line no-restricted-syntax -- 要一份全新的模块实例（没被 setup 打开过、没被工厂拿走过）；这个模块没有依赖，冷加载是毫秒级
    const fresh = await import("./generationPlanningIssue");
    expect(() => fresh.issueGenerationPlanningForTest(async () => ({}))).toThrow(/generation_planning_test_issue_closed/);
  });

  it("往名单里记的能力只发一次：工厂拿走之后别处再要就抛错", async () => {
    vi.resetModules();
    // eslint-disable-next-line no-restricted-syntax -- 要一份全新的模块实例（没被 setup 打开过、没被工厂拿走过）；这个模块没有依赖，冷加载是毫秒级
    const fresh = await import("./generationPlanningIssue");
    fresh.claimGenerationPlanningIssuer();
    expect(() => fresh.claimGenerationPlanningIssuer()).toThrow(/generation_planning_issuer_already_claimed/);
  });
});

// ── 类型反例：这些写法今天就该编不过（不执行，只给类型检查看）。──
export function typeLevelCounterexamples(ports: GenerationHostPorts): void {
  const handWritten = handWrittenPlanning();

  // ① 手写的规划（没有工厂的记号）交给门的权威。
  // @ts-expect-error 门只收生成装配工厂发的规划
  createRunOwnedGenerationGateAuthority({ owner: {} as never, operations: {} as never, planning: handWritten, receipts: {} as never });
  // @ts-expect-error 界面的窄通道同理
  installGuiResolveNarrowIpc(handWritten);
  // @ts-expect-error 模型那一侧的传输同理
  createPiGenerationTransportAdapter({ projectId: "p", immutableProjectUuid: "u", projectGeneration: 1 }, { planning: handWritten, leaseFor: () => ({}) as never });

  // ② 工厂没有「模型表 / 目录从参数来」的入口。
  // @ts-expect-error 工厂不收模型表
  createGenerationDomain({ ...ports, registry: createModuleRegistry([]) });
  // @ts-expect-error 工厂不收目录来源
  createGenerationDomain({ ...ports, catalog: { openCall: () => ({ registry: createModuleRegistry([]) }) } });

  // ③ 宿主真不一样的那几样全部必填：漏一样就红（这里漏了「派发前落画布」）。
  const { landShots: _omitted, ...missingLanding } = ports;
  // @ts-expect-error 少交一个端口
  createGenerationDomain(missingLanding);

  // ④ 规划逻辑没有「不带这次调用的目录也能装」的写法。
  // @ts-expect-error 必须给目录来源
  createGenerationPlanningHandler({ operations: createInMemoryGenerationOperationStore() });
  // @ts-expect-error 模型表不能绕过目录来源直接递
  createGenerationPlanningHandler({ registry: createModuleRegistry([]), operations: createInMemoryGenerationOperationStore() });
}
