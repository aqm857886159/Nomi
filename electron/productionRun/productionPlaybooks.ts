// 已实现的制作 playbook 注册表 —— 「哪些 playbook 真跑得动」的唯一真相源。
//
// 为什么要它（2026-08-18 修的坑）：这条流水线的阶段/门/产物原先由 repository.create 里一句
// `input.playbook.name === "brand.promo"` 决定，别的名字**静默降级**成一个 stages/gates/jobs
// 全空、永远停在 draft 的坏 Run，而工具还回「成功」。字面量散落多处 ⇒ 加第二个 playbook 必漏改
// 一处；MCP 工具描述里的「例如 brand.promo」也会和实现对不上（暗示还有别的，实际只有这一个）。
//
// 收进这里之后：① repository.create 读它决定阶段，未登记的名字**写盘前**抛人话错误；
// ② MCP 工具目录的 playbook enum 从 listProductionPlaybookNames() derive，描述结构上不可能再撒谎。
// 加新 playbook = 这里加一条 + 让 driver 认得它的阶段，不用再回去改 create。

import type { ProductionStage } from "./productionRunTypes";
import { emitMcpToolCatalogChanged } from "../capabilityCore/mcpToolCatalogChanges";

export type ProductionPlaybookStageTemplate = {
  readonly stageId: string;
  readonly title: string;
};

export type ProductionPlaybookDefinition = {
  readonly name: string;
  /** 阶段模板；数组顺序即 stage.order。 */
  readonly stages: readonly ProductionPlaybookStageTemplate[];
  /** 起草即完成的阶段（brief 落盘就算走完）。 */
  readonly briefStageId: string;
  /** 起草后停在这个阶段等第一道门（方向门）。 */
  readonly directionStageId: string;
};

const BRAND_PROMO: ProductionPlaybookDefinition = {
  name: "brand.promo",
  briefStageId: "brief",
  directionStageId: "direction",
  stages: [
    { stageId: "brief", title: "Brief" },
    { stageId: "direction", title: "Direction" },
    { stageId: "script", title: "Script" },
    { stageId: "storyboard", title: "Storyboard" },
    { stageId: "build", title: "Canvas" },
    { stageId: "generate", title: "Generate" },
    { stageId: "qa", title: "QA" },
    { stageId: "assemble", title: "Assemble" },
    { stageId: "export", title: "Export" },
  ],
};

/**
 * 注册表自检：登记错的 playbook（阶段 id 重复、brief/direction 指向不存在的阶段）在模块加载期就炸，
 * 不留到用户起草时才发现——与 playbookOrchestrator 拒环/拒悬空依赖同一纪律。
 */
function validated(definition: ProductionPlaybookDefinition): ProductionPlaybookDefinition {
  const ids = new Set<string>();
  for (const stage of definition.stages) {
    if (ids.has(stage.stageId)) throw new Error(`playbook「${definition.name}」阶段 id 重复：${stage.stageId}`);
    ids.add(stage.stageId);
  }
  for (const [label, stageId] of [["brief", definition.briefStageId], ["direction", definition.directionStageId]]) {
    if (!ids.has(stageId)) throw new Error(`playbook「${definition.name}」的 ${label} 阶段不存在：${stageId}`);
  }
  return definition;
}

let REGISTRY: readonly ProductionPlaybookDefinition[] = [BRAND_PROMO].map(validated);

/** Register a playbook and wake active MCP clients so they refresh tools/list. */
export function registerProductionPlaybook(definition: ProductionPlaybookDefinition): void {
  const next = validated(definition);
  if (REGISTRY.some((entry) => entry.name === next.name)) {
    throw Object.assign(new Error("production_playbook_already_registered"), {
      code: "production_playbook_already_registered",
    });
  }
  REGISTRY = [...REGISTRY, next];
  emitMcpToolCatalogChanged();
}

/** 可用 playbook 名单（MCP 工具 enum / 错误提示都从这里 derive，不另写一份）。 */
export function listProductionPlaybookNames(): string[] {
  return REGISTRY.map((definition) => definition.name);
}

export function findProductionPlaybook(name: string): ProductionPlaybookDefinition | null {
  const clean = String(name || "").trim();
  return REGISTRY.find((definition) => definition.name === clean) ?? null;
}

/** 未登记 ⇒ 抛人话错误（会经 MCP 原样带回给发起端 agent），不静默降级成一个推不动的 Run。 */
export function requireProductionPlaybook(name: string): ProductionPlaybookDefinition {
  const found = findProductionPlaybook(name);
  if (found) return found;
  const clean = String(name || "").trim() || "(空)";
  throw new Error(`playbook「${clean}」不存在。当前可用：${listProductionPlaybookNames().join("、")}`);
}

/** 起草时的初始阶段表：brief 已完成、direction 等门、其余待办。 */
export function initialPlaybookStages(
  definition: ProductionPlaybookDefinition,
  timestamp: string,
): ProductionStage[] {
  return definition.stages.map((stage, order) => {
    if (stage.stageId === definition.briefStageId) {
      return { stageId: stage.stageId, title: stage.title, status: "completed", order, startedAt: timestamp, completedAt: timestamp };
    }
    if (stage.stageId === definition.directionStageId) {
      return { stageId: stage.stageId, title: stage.title, status: "awaiting_gate", order, startedAt: timestamp };
    }
    return { stageId: stage.stageId, title: stage.title, status: "pending", order };
  });
}
