/**
 * 「这份规划是生成装配工厂发的」——名单和核对。
 *
 * 用到规划的位置（门的权威、派发入口、界面的窄通道、常驻生成面）只认工厂发出去的那一个：
 *  · 类型上带记号（`IssuedByGenerationDomain`），手写一份规划逻辑的返回值放不进去；
 *  · 类型能被 `as` 骗过，所以装上的那一刻再核一遍这里的名单，不在名单里就抛错。
 *
 * 往名单里记的能力只发一次：`claimGenerationPlanningIssuer()` 第一个调的人拿走，第二个人调就抛错。
 * 工厂模块（`generationDomain.ts`）在加载时拿走它——别的模块想自己往名单里记，进程一起来就红。
 */

declare const ISSUED_BY_GENERATION_DOMAIN: unique symbol;
/** 记号只有工厂造得出来。 */
export type IssuedByGenerationDomain = { readonly [ISSUED_BY_GENERATION_DOMAIN]: true };

// 不留强引用：规划没人用了就能回收。
const issued = new WeakSet<object>();
const record = <T extends object>(planning: T): T & IssuedByGenerationDomain => {
  issued.add(planning);
  return planning as T & IssuedByGenerationDomain;
};

let issuerClaimed = false;
/** 只有生成装配工厂调（模块加载时，一次）。 */
export function claimGenerationPlanningIssuer(): <T extends object>(planning: T) => T & IssuedByGenerationDomain {
  if (issuerClaimed) throw new Error("generation_planning_issuer_already_claimed: only generationDomain.ts may issue generation planning");
  issuerClaimed = true;
  return record;
}

/** 用到规划的位置在装上 / 用到的那一刻调：不是工厂发的就抛错。 */
export function assertIssuedGenerationPlanning<T>(planning: T, where: string): asserts planning is T & IssuedByGenerationDomain {
  if (typeof planning !== "function" || !issued.has(planning)) {
    throw Object.assign(new Error(`generation_planning_not_issued: ${where} only accepts the planning issued by createGenerationDomain`), { code: "generation_planning_not_issued" });
  }
}

// 测试的桩（测派发和门、不测装配的那些）也要进名单。发放的能力只由测试 setup 文件打开；
// 生产里没有人打开过，调了就抛错。这两个函数只许测试 setup 文件和 `*.testkit.ts` 引。
let testIssueOpen = false;
export function openGenerationPlanningTestIssue(): void { testIssueOpen = true; }
export function issueGenerationPlanningForTest<T extends object>(planning: T): T & IssuedByGenerationDomain {
  if (!testIssueOpen) throw new Error("generation_planning_test_issue_closed: only the test setup file may open it");
  return record(planning);
}
