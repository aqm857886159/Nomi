#!/usr/bin/env node
// 文件体积门岗 —— 落实 CLAUDE.md 规则 12（约束代码量、防巨型文件）。
//
// 机制（棘轮，只减不增）：
//   1. 任何非测试的 .ts/.tsx/.mts/.cts，行数不得超过 MAX_LINES（硬上限）。
//   2. 现存已超限的"巨壳"列入 ALLOWLIST 并记录基线行数；它们：
//        - 超过基线 → 红牌（你把已知巨壳改得更大了：拆分或精简，别再喂）。
//        - 低于基线 → 黄牌提示（你瘦身了，请把基线下调以锁定战果）。
//      目标是逐步把 ALLOWLIST 清空。
//   3. 新文件不得超过 MAX_LINES —— 想新增超限文件 = 先拆，或人工评审后入白名单。
//
// CSS 文件由规则 10 单独治理（只可减不可增），不在本门岗范围。
//
// 用法：node ./scripts/check-file-sizes.mjs

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LINES = 800;
const SCAN_DIRS = ["src", "electron"];

// 现存巨壳的基线行数（棘轮上限）。清空此表 = 巨壳债还清。
// 改小某个数 = 你成功瘦身后锁定的新上限。新增条目应经人工评审。
const ALLOWLIST = {
  "electron/runtime.ts": 519, // …→ 531（2026-08-27 pi 运行切换移除旧 Agent 再导出）→ 530（2026-08-28 onboarding facade cleanup）→ 526（2026-08-30 runtime lifecycle cleanup）→ 519（2026-09-01 actual-cost 接线时把两处终态 trace 收成单行，净瘦身）
  // Conversational model integration boundary: the session service keeps the
  // state machine, receipt contract, canonical certification and recovery
  // transitions together. It is reviewed as one security boundary and must
  // be split only along a stable ownership seam, not by moving methods into
  // a second writer. (2026-08-29)
  "electron/integrationCertification/integrationSession.ts": 1696,
  // Existing SettingsDialog shell now owns the durable integration handoff
  // projection alongside the legacy model settings pages. Keep this reviewed
  // baseline until the planned settings-surface extraction. (2026-08-29)
  "src/ui/onboarding/OnboardingDrawer.tsx": 811,
  "src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx": 713, // …→ 731（2026-08-25 P4 S6：多镜叠加合一 ProductionShotOverlays）→ 713（2026-08-29 React Flow 单内核：移除旧布局与缩放分支）
  // Project Agent Host 迁移巨壳（M1 transplant：electron 切片随 r2 入库、renderer 切片随
  // 本次 cutover 入库；上游 pr223 原型已人工评审同一批 owner，数字按本分支实际行数锁棘轮，
  // 只减不增，下一个分解批次按稳定 ownership seam 拆分后逐个出表）。834→836：并 origin/main 的
  // TikHub connector（#296）加 registerTikhubConnectorIpc 的 import+调用两行；836→839：#298-v2
  // 自定义 MCP 客户端 profile 接入（registerCustomMcpProfileIpc + watchMcpProfiles + import）3行；
  // 839→846：registerIntegrationHandoffIpc + registerIntegrationSessionIpc 的 import+调用（integration
  // certification handoff queue，0b6441c6 transplant 时误删后按根因恢复）7行；仍远低于本分支起点 847。
  "electron/main.ts": 846,
  "electron/projectAgentHost/projectAgentState.ts": 803,
  // Phase 6 常驻壳成为唯一 Agent UI 后的应用外壳（pr223 评审基线曾为 908；并 origin/main 拆解面板宿主后
  // 折叠一行多名 import，曾 907；m1 侧栏收起修复顺手折叠 hydrate/navigate 多行调用参数，实际 903，锁棘轮只减不增）。
  "src/workbench/NomiStudioApp.tsx": 903,
  // PR#21 白板节点引入（2026-06-25）：WhiteboardDrawingTool（1032）与 WhiteboardLeaferCanvas（3406）两巨壳
  // 已按 Rule 9 全部拆完、双双出白名单。LeaferCanvas → whiteboardCanvasTypes/Export/NodeOps/Geometry 四纯模块
  // + whiteboardSceneRender（渲染树）+ useWhiteboardDrawing/BoxSelection/SelectionActions/SceneSync 四交互 hook，
  // 壳缩到 740 < 800。DrawingTool → WhiteboardToolbarControls + whiteboardStateOps，壳 760。
  // generationCanvasStore.ts 曾 871 行（巨壳）；S5-0 按 zustand slice 模式拆出 canvasStoreTypes.ts +
  // canvasNodeActions.ts + canvasGraphActions.ts + canvasRunActions.ts 后壳文件缩到 161 < 800，已出白名单。
  // NodeParameterControls.tsx 曾 1097 行（巨壳）；C2b 抽出 controls/parameterControlModel.ts +
  // archetypeMeta.ts + ModeBar.tsx 后缩到 605 < 800 硬上限，已出白名单（Rule 12：逐步清空白名单）。
  // Scene3DFullscreen.tsx 曾 3822 行（最大巨壳）；#10b 拆出 scene3dToolbar/inspector/objects/
  // viewControllers/sceneView/sceneContent/cameraPreview 七个子模块后壳缩到 771 < 800，已出白名单。
};

function listFiles() {
  // 用 git 列出受跟踪文件，天然排除 node_modules / dist / 未跟踪草稿。
  const out = execSync("git ls-files " + SCAN_DIRS.join(" "), { cwd: ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => /\.(?:tsx?|[mc]ts)$/.test(f))
    .filter((f) => !/\.test\.(?:tsx?|[mc]ts)$/.test(f))
    .filter((f) => !/\.d\.(?:ts|[mc]ts)$/.test(f))
    // i18n 翻译资源是「数据表」不是代码复杂度 —— R9/R12 治的是代码模块化，
    // locale 词典随翻译量线性增长天然会破 800，不适用本门（2026-07-22 全量 i18n 落地）。
    .filter((f) => !/^src\/i18n\/(locales\/.*|resources)\.ts$/.test(f))
    // git ls-files 会连「工作树里已删除、尚未 commit」的文件一起列出——门岗量的是
    // 工作树现状，消失的文件没有体积可查，跳过（commit 后 CI checkout 恒存在，不削弱棘轮）。
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
}

function countLines(absPath) {
  // 与 `wc -l` 一致：统计换行符数量。
  const content = fs.readFileSync(absPath, "utf8");
  return (content.match(/\n/g) || []).length;
}

const errors = [];
const warnings = [];

for (const rel of listFiles()) {
  const lines = countLines(path.join(ROOT, rel));
  const baseline = ALLOWLIST[rel];
  if (baseline !== undefined) {
    if (lines > baseline) {
      errors.push(`✗ ${rel}: ${lines} 行 > 基线 ${baseline}（已知巨壳又长大了 —— 拆分或精简，别再喂）`);
    } else if (lines < baseline) {
      warnings.push(`↓ ${rel}: ${lines} 行 < 基线 ${baseline}（已瘦身，请把 check-file-sizes.mjs 里的基线下调到 ${lines} 以锁定）`);
    }
  } else if (lines > MAX_LINES) {
    errors.push(`✗ ${rel}: ${lines} 行 > 上限 ${MAX_LINES}（新巨型文件 —— 请拆分；确需保留须人工评审后入 ALLOWLIST）`);
  }
}

for (const w of warnings) console.warn(w);

if (errors.length > 0) {
  console.error("\n文件体积门岗未通过（规则 12）：\n" + errors.join("\n") + "\n");
  process.exit(1);
}

console.log(`✓ 文件体积门岗通过：上限 ${MAX_LINES} 行，巨壳白名单 ${Object.keys(ALLOWLIST).length} 个（棘轮只减不增）。`);
