/**
 * 测试用：把一份规划（桩，或测试自己拿静态表搭的规划逻辑）递进「只认生成装配工厂发的」那些位置。
 *
 * 这些位置在生产里只收 `createGenerationDomain()` 发出去的规划。测派发、门、传输、卡片编排的测试不测装配，
 * 要递一个桩进去是正当的：桩经这里进名单。发放的能力只由测试 setup 文件打开
 * （`tests/setup/generationPlanningTestIssue.ts`），生产里调这里的任何一个都会抛错。
 */
import { createPiGenerationTransportAdapter } from "./generationTransportAdapters";
import { issueGenerationPlanningForTest } from "./generationPlanningIssue";

export { issueGenerationPlanningForTest };

type AdapterArgs = Parameters<typeof createPiGenerationTransportAdapter>;
type TestAdapterDeps = Omit<AdapterArgs[1], "planning"> & { planning: (input: never) => unknown };

/** 模型那一侧的传输，规划是测试给的（桩或手搭的规划逻辑）。 */
export function createPiGenerationTransportAdapterForTest(binding: AdapterArgs[0], deps: TestAdapterDeps): ReturnType<typeof createPiGenerationTransportAdapter> {
  return createPiGenerationTransportAdapter(binding, { ...deps, planning: issueGenerationPlanningForTest(deps.planning) } as unknown as AdapterArgs[1]);
}
