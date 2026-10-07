/**
 * 「Nomi 自己消费、永远不发给供应商」的那几个候选参数键——**全仓唯一的那一张表**。
 *
 * 为什么需要它：`compileParameters` 对**没被声明过的参数键直接报错**（此前是静默丢弃，
 * 于是「卡上选 2K、供应商收到 1k、节点还印 2K」这种事一声不响地发生）。报错是对的——参数编译
 * 的合法键集由档案的 `mode.params`、其次由那条 mapping 的 create op 派生，不在里面就是这个模型
 * 真的做不到。
 *
 * 但有一小撮键**本来就不该上线缆**：它们是给 Nomi 的推荐器与时长推断读的意图
 * （`videoRecommendationInput` / `requestedVideoDurationSeconds`），例如「这一镜要保住同一个人」
 * 「机位想怎么动」「整片目标时长」。它们历史上也走 `candidate.parameters` 递进来。
 * 把它们混进「不认识 → 报错」那一档会把正常的视频规划整条打掉；混进「静默丢弃」又正是我们要
 * 消灭的那个形状。所以第三条路：**列一张有名字、有 owner、有测试的表**，命中它的键放行但不进合同。
 *
 * **每个键连同它的类型一起声明**（2026-09-22 验收：只有键名的那一版里
 * `{quality: 99999, preferredFamily: {a:1}}` 会被原样吞掉、连 warning 都没有——比「没有参数表」
 * 那条分支还弱）。现在类型不对照样拒，与真参数同一套话术。
 *
 * **一张表、一个 owner（2026-09-22 总合并）**：打捞分支的 `GENERATION_PLANNING_PARAMETER_KEYS`
 * （只有键名、含时长与别名四个键）与 #837 的 `GENERATION_PLANNING_HINTS`（带类型、只有推荐器那六个键）
 * 说的是同一件事，两边各修了一遍。合并规则 = **键取并集、类型取 #837 那一版的形状**；
 * `executionContract.ts` 只从这里 re-export，不再自己写一份。
 *
 * owner 的活判据在 `generationPlanningParameters.test.ts`：逐个键真喂进去，
 * 看 `videoRecommendationInput` 或 `requestedVideoDurationSeconds` 读不读得到它——
 * 表和读者漂开的那一刻测试就红，不靠注释维持。
 */
import type { ParameterField } from "./moduleManifest";

export const GENERATION_PLANNING_HINTS = Object.freeze({
  // videoRecommendationInput 的意图轴
  cameraIntent: "string",
  preferredFamily: "string",
  preserveCharacter: "boolean",
  preserveTransition: "boolean",
  quality: "string",
  useReferenceAudio: "boolean",
  // 同一个语义的 camelCase 别名（线缆键是 snake_case 的那一份；别名只在 Nomi 内部出现）
  //
  // 2026-10-05：`aspectRatio` 从这张表删掉了。它曾在这里被当成「只给推荐器读」的意图键，编合同时
  // `continue` 掉、永不上线缆——而模型面上它正是 Agent 写比例时最常猜的那个名字，于是用户说的 16:9
  // 被静默吞掉、付费卡上是档案默认。现在它是**语义载体键**：宿主在写入口把它翻成所选模式的真实键
  // （`semanticAspectRatio.ts`），翻不了就拒；漏翻到编译口的照「未知参数」拒，不再有静默的一档。
  durationSeconds: "number",
  // 长片意图（semanticGenerationCandidate.requestedVideoDurationSeconds 读）
  totalDurationSeconds: "number",
  targetDurationSeconds: "number",
} as const satisfies Record<string, ParameterField["type"]>);

export const GENERATION_PLANNING_HINT_KEYS = Object.freeze(
  Object.keys(GENERATION_PLANNING_HINTS) as Array<keyof typeof GENERATION_PLANNING_HINTS>,
);

/** 旧名保留给按「是不是意图键」提问的调用方；判据与上表同一份，没有第二个集合。 */
export const GENERATION_PLANNING_PARAMETER_KEYS: ReadonlySet<string> = Object.freeze(
  new Set<string>(GENERATION_PLANNING_HINT_KEYS),
);

export function isGenerationPlanningParameter(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(GENERATION_PLANNING_HINTS, key);
}

/** 这个意图键声明的类型；不是意图键就是 undefined（调用方据此走「真参数」那一档）。 */
export function generationPlanningHintType(key: string): ParameterField["type"] | undefined {
  return isGenerationPlanningParameter(key)
    ? (GENERATION_PLANNING_HINTS as Record<string, ParameterField["type"]>)[key]
    : undefined;
}
