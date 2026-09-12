// 模型可见工具的**唯一注册表**，与从它派生的两个 profile（方案 §3.1，阶段 5a；PR A 收成单一 owner）。
//
// 这个文件回答的是一个问题：**「模型看得见什么」这件事，谁说了算。**
// 答案只有一个：`verbDeclarations.ts` 里的那张 `VERB_DECLARATIONS`。这里把每条声明派生成说明书
// （`toModelFacingToolSpec`），再按 profile 投影。harness 清单（`intent` + `{sideEffect,risk}`）与契约上的
// `projections.{pi,mcp}.description` 两扇门已随 PR A 删除——它们没有独立消费者，只是第二、第三份文案。
//
// 差异**只能**来自声明，共三种，全部机器可查：
//   ① `profiles` + `profileReason` —— 「外部才有 / 内部才有」，理由只能是领域约束；
//   ② `effect:"spend"`             —— 付费动词不进内部 profile（装配期抛，不过滤）；
//   ③ MCP 的租约与归并             —— `leaseHandle` 首字段 + 一契约一工具（`projectMcpTool`）。
//
// 除此之外的任何不同都是漂移，`scripts/check-model-schema.ts` 的 `profile-schema-drift`
// 规则按能力逐条比指纹，当场红。
import { CAPABILITY_CONTRACTS, resolveCapabilityAlias } from "./registry";
import type { CapabilityContract } from "./capabilityContract";
import { projectsToInternalProfile } from "./paidBoundary";
import { VERB_DECLARATIONS } from "./verbDeclarations";
import {
  projectMcpTool,
  modelToolCapabilityId,
  projectsToProfile,
  toModelFacingToolSpec,
  type McpProfileTool,
  type ModelFacingToolSpec,
  type ToolProfile,
} from "./modelFacingTools";

type AnyCapabilityContract = CapabilityContract<unknown, unknown>;

function contractById(id: string): AnyCapabilityContract | undefined {
  return CAPABILITY_CONTRACTS.find((contract) => contract.id === id);
}

/**
 * **顺序是合同，不是审美**：`tools/list` 的确定性顺序是 prompt/KV-cache 合同（上游 `splitDeferredTools`
 * 靠稳定前缀保住缓存）。顺序由 `VERB_DECLARATIONS` 定，这里不再排序。
 *
 * 装配期不变量（A1–A4）已在 `assembleVerbDeclarations` 跑过；这里只剩一条 profile 级的：
 * 投影到内部 profile 的动词不得落在付费契约上——`projectsToInternalProfile` 从 PR A 起是断言而不是过滤
 * （审计 C12：静默过滤会让一个漏标 `paid` 的花钱契约静默进内部面）。
 */
function collectSpecs(): readonly ModelFacingToolSpec[] {
  return Object.freeze(VERB_DECLARATIONS.map((declaration) => {
    const spec = toModelFacingToolSpec(declaration);
    const contract = contractById(spec.contractId);
    if (!contract) throw new Error(`Model-facing tool ${spec.name} names an unregistered capability: ${spec.contractId}`);
    if (projectsToProfile(spec, "internal") && !projectsToInternalProfile(contract)) {
      throw new Error(`${spec.name} projects to the internal profile but its capability ${contract.id} is on the paid boundary.`);
    }
    return spec;
  }));
}

export const MODEL_FACING_TOOL_SPECS: readonly ModelFacingToolSpec[] = collectSpecs();

/** Resolve current model names and external aliases through their actual descriptor owners. */
export function resolveModelToolCapabilityId(name: string, args?: unknown): string | undefined {
  const spec = MODEL_FACING_TOOL_SPECS.find(candidate => candidate.name === name);
  return spec ? modelToolCapabilityId(spec, args) : resolveCapabilityAlias(name)?.contract.id;
}

/** 某个能力的全部别名说明书，按声明顺序。 */
export function specsForCapability(contractId: string): readonly ModelFacingToolSpec[] {
  const matched = MODEL_FACING_TOOL_SPECS.filter((spec) => spec.contractId === contractId);
  if (contractId === "canvas.write") {
    const canonical = matched.find((spec) => spec.name === "arrange_canvas");
    if (canonical) return Object.freeze([...matched, ...["nomi_canvas_write", "nomi_canvas_edit", "nomi_canvas_plan", "nomi_storyboard_write", "nomi_shot_reference_write"].map(name => ({ ...canonical, name }))]);
  }
  return matched;
}

/** 一个 profile 真正投影出去的说明书。过滤只来自声明（`profiles`）；付费边界在装配期已经抛过。 */
export function modelFacingToolSpecs(profile: ToolProfile): readonly ModelFacingToolSpec[] {
  return Object.freeze(MODEL_FACING_TOOL_SPECS.filter((spec) => projectsToProfile(spec, profile)));
}

/** 有模型可见描述符、且对外投影的能力（按契约注册顺序）。 */
export function mcpProjectedCapabilities(): readonly AnyCapabilityContract[] {
  const projected = new Set(modelFacingToolSpecs("mcp").map((spec) => spec.contractId));
  return Object.freeze(CAPABILITY_CONTRACTS.filter((contract) => projected.has(contract.id)));
}

/**
 * 对外 MCP profile：一契约一工具，名字取自契约自己声明的 `aliases.mcp`，描述与 schema 由
 * `projectMcpTool` 从同一批说明书机械派生。
 */
export function mcpProfileTools(): readonly McpProfileTool[] {
  const specs = modelFacingToolSpecs("mcp");
  return Object.freeze(mcpProjectedCapabilities().map((contract) =>
    projectMcpTool(contract, specs.filter((spec) => spec.contractId === contract.id))));
}

export function mcpProfileToolFor(contractId: string): McpProfileTool | undefined {
  return mcpProfileTools().find((tool) => tool.contractId === contractId);
}
