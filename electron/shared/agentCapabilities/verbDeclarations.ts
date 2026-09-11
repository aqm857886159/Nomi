// 模型可见动词的**唯一装配入口**。`modelFacingToolRegistry.ts` 只从这里读；lane、MCP、门岗都从注册表派生。
//
// **顺序是合同，不是审美**：目录顺序进系统提示词与 `tools/list`，是 prompt/KV-cache 的前缀
// （上游 `splitDeferredTools` 靠稳定前缀保住缓存）。按领域族固定拼，别按 `Object.keys` 之类会随实现漂的东西。
import { CAPABILITY_CONTRACTS } from "./registry";
import { isPaidBoundaryAlias } from "./paidBoundary";
import { assembleVerbDeclarations, type VerbDeclaration } from "./verbDeclaration";
import { canvasMaintenanceVerbs, canvasVerbs } from "./verbs/canvasVerbs";
import { documentVerbs } from "./verbs/documentVerbs";
import { generationVerbs, modelCatalogVerbs } from "./verbs/generationVerbs";
import { layoutVerbs } from "./verbs/layoutVerbs";
import { mediaVerbs } from "./verbs/mediaVerbs";
import { productionVerbs } from "./verbs/productionVerbs";
import { timelineVerbs } from "./verbs/timelineVerbs";

export const VERB_DECLARATIONS: readonly VerbDeclaration[] = assembleVerbDeclarations({
  // 常驻 10 个（文稿 5 + 画布 4 + read_timeline）在前；延迟组按 timeline → media → maintenance →
  // generation → production → models 排——与 PR A 之前系统提示词里的顺序逐字相同。
  declarations: [
    ...documentVerbs(),
    ...canvasVerbs(),
    ...timelineVerbs(),
    ...mediaVerbs(),
    ...canvasMaintenanceVerbs(),
    ...generationVerbs(),
    ...productionVerbs(),
    ...modelCatalogVerbs(),
    // 只投对外 profile 的两个（无头宿主）；排在内部目录之后，不影响内部 profile 的顺序合同。
    ...layoutVerbs(),
  ],
  contractById: (id) => CAPABILITY_CONTRACTS.find((contract) => contract.id === id),
  isPaidBoundaryName: isPaidBoundaryAlias,
});
