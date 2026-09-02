// 能力校验（纯函数，可单测）——接线现为死代码的 requiredProviders + stages.modelPrefs，
// 算出工作流元数据所描述的依赖 / 当前实例缺哪些。这些字段不参与运行时授权；
// requestedCapabilities 才能在 Host capability ceiling 内进一步收窄工具。
// 这是 Flova 式「能力清单 + 缺啥去接入」
// 的根（docs/plan/2026-06-19-skill-playbook-system.md §0.5.b/0.5.d）。
// 关键：缺能力 ≠ 报错，而是产出一张「缺什么」清单交给 UI 引导用户去接入（n8n 二分 / Dify 三态）。
import type { SkillManifest, SkillProviderKind } from "./skillManifestSchema";
import type { RuntimeToolDescriptor } from "../harness/runtime/runtimePort";
import {
  CAPABILITY_CONTRACTS,
  capabilityAliasesFor,
  capabilityOperationAliasesFor,
} from "../shared/agentCapabilities/registry";
import { modelToolSurfaceManifest } from "../harness/tools/modelToolSurfaceManifest";

export type SkillCapabilityNeeds = {
  /** 这个 skill 端到端需要的 provider 模态（去重）。 */
  providers: SkillProviderKind[];
  /** 这个 skill 用到的工具名（去重；manifest.tools ∪ stages[].tools）。 */
  tools: string[];
  /** 阶段级模型家族偏好（如 ["seedance"]，软提示，不绑 vendor）。 */
  families: string[];
};

/** 从 manifest 派生「需要什么」：union(requiredProviders, stages.modelPrefs.kind) + union(tools, stages.tools)。 */
export function deriveSkillNeeds(manifest: SkillManifest): SkillCapabilityNeeds {
  const providers = new Set<SkillProviderKind>(manifest.requiredProviders);
  const tools = new Set<string>(manifest.tools);
  const families = new Set<string>();
  for (const stage of manifest.stages ?? []) {
    for (const tool of stage.tools) tools.add(tool);
    for (const pref of stage.modelPrefs ?? []) {
      providers.add(pref.kind);
      if (pref.family) families.add(pref.family);
    }
  }
  return {
    providers: [...providers],
    tools: [...tools],
    families: [...families],
  };
}

export type SkillCapabilityReport = {
  needs: SkillCapabilityNeeds;
  /** 缺的 provider 模态（available 里没有的）——UI 据此显示「⚠️ 视频 → 去接入」。 */
  missingProviders: SkillProviderKind[];
  /** 缺的工具名（注册工具集里没有的）——UI/加载期提示「引用了不存在的工具 X」。 */
  missingTools: string[];
  /** 所有需求都满足时为 true（可直接跑）。 */
  satisfied: boolean;
};

/**
 * 把「需要什么」对照「当前实例有什么」算出缺口。纯函数：
 * @param availableProviders 当前已接入且 enabled 的模型模态集合（catalog 派生，调用方提供）。
 * @param availableTools 当前 agent 引擎实际注册的工具名集合（gate TOOL_META 派生，调用方提供）。
 */
export function reportSkillCapability(
  manifest: SkillManifest,
  availableProviders: ReadonlySet<SkillProviderKind>,
  availableTools: ReadonlySet<string>,
): SkillCapabilityReport {
  const needs = deriveSkillNeeds(manifest);
  const missingProviders = needs.providers.filter((p) => !availableProviders.has(p));
  const missingTools = needs.tools.filter((t) => !availableTools.has(t));
  return {
    needs,
    missingProviders,
    missingTools,
    satisfied: missingProviders.length === 0 && missingTools.length === 0,
  };
}

/** A Skill request is a shrink-only filter over tools already granted by the Host capability. */
export function restrictToolsToSkillCapabilities(
  hostTools: readonly RuntimeToolDescriptor[],
  requestedCapabilities: readonly string[] | undefined,
): RuntimeToolDescriptor[] {
  if (requestedCapabilities === undefined) return [...hostTools];
  const canonicalCapabilityIds = new Set<string>(CAPABILITY_CONTRACTS.map((contract) => contract.id));
  const allowedPiAliases = new Set<string>();
  for (const capabilityId of requestedCapabilities) {
    if (!canonicalCapabilityIds.has(capabilityId)) {
      throw new Error(`Unknown canonical Skill capability: ${capabilityId}`);
    }
    for (const alias of capabilityAliasesFor(capabilityId, "pi")) allowedPiAliases.add(alias);
    for (const alias of capabilityOperationAliasesFor(capabilityId, "pi")) allowedPiAliases.add(alias);
  }
  const semanticNamesByCapability = new Map<string, Set<string>>();
  for (const descriptor of [
    ...modelToolSurfaceManifest.canvas,
    ...modelToolSurfaceManifest.document,
    ...modelToolSurfaceManifest.generation,
  ]) {
    for (const capability of descriptor.capabilityRefs) {
      const names = semanticNamesByCapability.get(capability) ?? new Set<string>();
      names.add(descriptor.name);
      semanticNamesByCapability.set(capability, names);
    }
  }
  const allowedSemanticNames = new Set<string>(requestedCapabilities.flatMap((capability) => [
    ...(semanticNamesByCapability.get(capability) ?? []),
  ]));
  return hostTools.filter((tool) => allowedPiAliases.has(tool.name) || allowedSemanticNames.has(tool.name));
}
