// 模型可见动词的**唯一装配入口**。`modelFacingToolRegistry.ts` 只从这里读；lane、MCP、门岗都从注册表派生。
//
// **顺序是合同，不是审美**：目录顺序进系统提示词与 `tools/list`，是 prompt/KV-cache 的前缀
// （上游 `splitDeferredTools` 靠稳定前缀保住缓存）。按领域族固定拼，别按 `Object.keys` 之类会随实现漂的东西。
//
// 22 个动词（设计正本 §5 + 2026-09-21 通用反问）：7 读 + 14 写 + 1 问。常驻（无 `internalGroup`）的是用户每一轮都可能碰到的那些；
// 生成 / 时间轴 / 素材 / 维护 / 技能 / 模型 按组延迟披露。
import { CAPABILITY_CONTRACTS, mcpToolNames } from "./registry";
import { isPaidBoundaryAlias } from "./paidBoundary";
import { assembleVerbDeclarations, type VerbDeclaration } from "./verbDeclaration";
import { askVerbs } from "./verbs/askVerbs";
import { onboardingVerbs } from "./verbs/onboardingVerbs";
import { assertVerbFieldProvenance } from "./verbs/verbFieldProvenance";
import { readVerbs } from "./verbs/readVerbs";
import { writeVerbs } from "./verbs/writeVerbs";

export const VERB_DECLARATIONS: readonly VerbDeclaration[] = assembleVerbDeclarations({
  // 接模型那五条只投对外 profile（见 verbs/onboardingVerbs.ts 文件头），内部面仍是 20 个动词。
  declarations: [...readVerbs(), ...writeVerbs(), ...askVerbs(), ...onboardingVerbs()],
  contractById: (id) => CAPABILITY_CONTRACTS.find((contract) => contract.id === id),
  isPaidBoundaryName: isPaidBoundaryAlias,
  // 只投对外 profile 的动词，说明书点名的是对外那一侧的名字（`nomi_read` …）。真相源仍是契约本身。
  mcpToolNames: mcpToolNames(),
});

// 第五条装配期不变量：**模型从哪拿到这个值**。前四条（`verbDeclaration.ts` 的 A1–A4）核的是声明本身
// 自洽，这一条核的是声明**可被填出来**——「宿主要一个模型根本拿不到的字段」当年让带参考图的分镜
// 100% 失败，而那件事编译得过、测试全绿、广播得出去。它在这里跑而不在门岗里跑，是因为不自洽时
// 广播出去的就是一份模型填不出来的合同（R17：能让 App 起不来的别留给门岗）。
assertVerbFieldProvenance(VERB_DECLARATIONS);
