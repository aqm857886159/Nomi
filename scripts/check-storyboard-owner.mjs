import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceRoot = path.join(root, 'src', 'workbench')
const forbidden = [
  /\bstoryboardPlans\b/,
  /(?:^|[.{])\s*storyboardPlan\s*:/,
  /(?:^|[.{])\s*storyboardPlanCommitted\s*:/,
]
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(file)
  }
}
walk(sourceRoot)
const violations = []
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  for (const pattern of forbidden) {
    if (pattern.test(source)) violations.push(`${path.relative(root, file)} matches ${pattern}`)
  }
}

// ── 第二段：整片默认 → 逐镜生成参数 的**贯通普查**（2026-09-12 根因合同）──
//
// 这一族 bug 的形状不是"少写了一个 if"，而是「整片级设置」在四段链路上各有一处可以静默掉队：
//   ① UI 能设   ② 方案 schema 留得住（zod 默认丢未知键 / 工具 envelope 是 .strict()）
//   ③ 落地路径读的是 resolver 而不是裸 `shot.params`   ④ 供应商没有该控件时诚实缺席
// 前两段可以机器验，第三段可以机器验（禁止裸铺），第四段由档案层保证（buildPlannedNodeMeta 丢未知键）。
// 普查表与逐格证据：docs/plan/2026-09-12-storyboard-plan-defaults-passthrough.md
const scopeOwner = path.join(sourceRoot, 'generationCanvas', 'agent', 'storyboardShotScope.ts')
const scopeSource = fs.readFileSync(scopeOwner, 'utf8')

// 登记表是唯一真相源：从 FILM_DEFAULTS 里把 (paramKey, planKey) 对抽出来，不在这里手抄一份。
const registry = [...scopeSource.matchAll(/paramKey:\s*'([^']+)'\s*,\s*planKey:\s*'([^']+)'/g)]
  .map(([, paramKey, planKey]) => ({ paramKey, planKey }))
if (registry.length === 0) {
  violations.push('storyboardShotScope.ts: FILM_DEFAULTS registry is empty or no longer parseable (paramKey/planKey pairs)')
}

// ② 每个登记的整片级键必须在两处 schema 里都有落脚点，否则规划师写的整片值会被静默丢掉：
//    渲染层 parseStoryboardPlan（zod 默认丢未知键）与主进程工具 envelope（`.strict()` 直接拒收）。
const schemaSurfaces = [
  ['src/workbench/generationCanvas/agent/storyboardPlanSchema.ts', 'storyboardPlanSchema (parseStoryboardPlan)'],
  ['electron/shared/agentCapabilities/canvasWrite.ts', 'storyboardPlanActionInputSchema (propose_storyboard_plan)'],
]
for (const [relative, label] of schemaSurfaces) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  for (const { planKey } of registry) {
    if (!new RegExp(`\\b${planKey}\\s*:`).test(source)) {
      violations.push(`${relative}: ${label} has no "${planKey}" key — a planner-emitted film-level value would be dropped on parse`)
    }
  }
}

// ③ 落地/投影路径不许绕过 resolver 直接铺 `shot.params`（那正是 2026-09-12 那个 bug 的两个出口）。
//    允许直接碰 `shot.params` 的只有：作用域 owner 自己、纯编辑层、工具 patch 写入、逐镜参数 UI、
//    以及只读展示。这份清单是**行为判据**，不是白名单豁免——新增一处必须先说清它为什么不是落地路径。
const rawParamsPattern = /shot\.params|keyframe\??\.params/
const rawParamsAllowed = new Set([
  'src/workbench/generationCanvas/agent/storyboardShotScope.ts',      // owner
  'src/workbench/generationCanvas/agent/storyboardPlanEdits.ts',      // 纯编辑（新增/复制镜头）
  'src/workbench/generationCanvas/agent/storyboardPatchShots.ts',     // 工具 patch 写入
  'src/workbench/generationCanvas/agent/storyboardPlan.ts',           // 注释引用（代码走 resolver）
  'src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx',    // 逐镜参数编辑 UI
  'src/workbench/creation/storyboard/shotRow/shotRowModel.ts',        // 逐镜字段只读投影
  'src/workbench/creation/storyboard/shotPresentation.ts',            // 只读展示
  'src/workbench/creation/storyboard/exec/storyboardOverrideActions.ts', // 行覆盖写入
  'src/workbench/creation/storyboard/exec/storyboardProjection.ts',   // 注释引用（代码走 resolver）
  'src/workbench/creation/storyboard/StoryboardShotTable.tsx',        // 逐行「参数应用到全部」命令
  'src/workbench/ai/resident/residentToolDisplay.ts',                 // 工具调用的人话展示
])
for (const file of files) {
  const relative = path.relative(root, file)
  if (rawParamsAllowed.has(relative) || /\.test\.tsx?$/.test(relative)) continue
  const source = fs.readFileSync(file, 'utf8')
  if (rawParamsPattern.test(source)) {
    violations.push(
      `${relative} reads shot.params directly — film-level defaults would not reach it. `
      + 'Call resolveShotParams/resolveKeyframeParams (storyboardShotScope.ts) instead.',
    )
  }
}

// ③b 两条落地路径必须**确实**调到 resolver（只禁裸铺还不够：整段删掉也会"通过"）。
const resolverCallSites = [
  ['src/workbench/generationCanvas/agent/storyboardPlan.ts', 'resolveShotParams', 'buildShotRowNodes (plan → canvas nodes)'],
  ['src/workbench/generationCanvas/agent/storyboardPlan.ts', 'resolveKeyframeParams', 'buildShotRowNodes (first-frame node)'],
  ['src/workbench/creation/storyboard/exec/storyboardProjection.ts', 'resolveShotParams', 'projectShotNode (plan edits → node meta)'],
  ['src/workbench/creation/storyboard/exec/storyboardProjection.ts', 'resolveKeyframeParams', 'projectShotNode (first-frame node)'],
  ['src/workbench/generationCanvas/agent/storyboardStrategy.ts', 'resolveShotParams', 'storyboardPlanToPlanShotInputs (strategy resolver input)'],
]
for (const [relative, fn, label] of resolverCallSites) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  if (!new RegExp(`${fn}\\(`).test(source)) {
    violations.push(`${relative}: ${label} no longer calls ${fn}() — film-level defaults stop reaching the request there`)
  }
}

if (violations.length) {
  console.error('❌ storyboard owner gate')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}
console.log(
  `✅ storyboard owner gate: ${files.length} renderer files checked; plan owner is storyboardDesignsByDocumentId; `
  + `${registry.length} film-level default(s) [${registry.map((entry) => `${entry.planKey}→${entry.paramKey}`).join(', ')}] `
  + 'survive both schemas and reach every materialize path through storyboardShotScope',
)
