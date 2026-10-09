#!/usr/bin/env node
// 画布「写边」入口门岗（2026-10-10，Codex 对 #1137 的复审 2）。
//
// 病：「这条边合不合法」的规则（electron/shared/canvas/edgeAdmission 的 validateReferenceEdge）只挡了手动连线和 Agent；
// MCP / headless 写图、粘贴、拖动复制各自把边原样写进去，视频 / 声音 → 文本这类非法边照样落库。
// 修法是让「新边进画布」只剩几扇有名字的门，每扇都过同一道闸；本门岗钉死两件事：
//   ① 画布领地里（generationCanvas / capabilityCore / shared/canvas）谁能直接写 `.edges` 数组，是一张写死的名单；名单外新增一处 = 红。
//   ② 名单里每个文件必须真的在调那道闸（引用 admitNewEdges / appendAdmittedEdges / validateReferenceEdge …），
//      且「整批追加」写法（`.edges = [...x.edges, …]` / `.edges.push(`）只准在登记过的几个文件里出现。
// 没有 --update：名单只能手改，改的时候要写清理由。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SCAN_ROOTS = ['src/workbench/generationCanvas', 'src/workbench/project', 'electron/capabilityCore', 'electron/shared/canvas']

/** 允许直接写 `.edges` 数组的文件 → 它为什么安全 + 它必须出现的「过闸」标记（任一）。 */
export const EDGE_WRITERS = {
  'src/workbench/generationCanvas/store/canvasEdgeWrite.ts': { why: '整条边追加的唯一落点：admitNewEdges 过闸后才写', mustCall: ['admitNewEdges('] },
  'src/workbench/generationCanvas/store/canvasDocumentCommit.ts': { why: '整图写回的恢复类门（加载 / 撤销重做 / 放回）：不造新边；外部写回在 mergeExternalCanvasWrite 里过闸', mustCall: ['mergeExternalCanvasWrite('] },
  'src/workbench/generationCanvas/store/canvasGraphActions.ts': { why: '单条 / 组连线：writeCanvasEdge 的 decide 与组物化都经 resolveCanvasReferenceConnection / validateReferenceEdge；其余是断开 / 改语义', mustCall: ['validateReferenceEdge(', 'resolveCanvasReferenceConnection('] },
  'src/workbench/generationCanvas/store/canvasNodeActions.ts': { why: '只删边 / 规范化；复制为变体与模板实例化的新边走 appendAdmittedEdges', mustCall: ['appendAdmittedEdges('] },
  'src/workbench/generationCanvas/store/generationCanvasStore.ts': { why: '剪切 / 释放项目只删边；粘贴的新边走 appendAdmittedEdges', mustCall: ['appendAdmittedEdges('] },
  'electron/capabilityCore/canvasGraph.ts': { why: 'headless（MCP）写图的连线：push 之前 validateReferenceEdge', mustCall: ['validateReferenceEdge('] },
  'electron/shared/canvas/externalCanvasWrite.ts': { why: '外部整图写回（渲染层 store 与盘上写共用）：外部新增 / 改了端点的边过 admitNewEdges，只有明确标成放回的边免查', mustCall: ['admitNewEdges('] },
  'electron/capabilityCore/dispatcher.ts': { why: 'MCP 删除后撤销 = 放回原来就有的边：明确走 restoredEdgeIds（恢复语义，与 UI restoreGraph 一致）', mustCall: ['restoredEdgeIds'] },
  'src/workbench/generationCanvas/events/canvasEventReducer.ts': { why: '事件重放 = 投影已记录的事实，不是新建边', mustCall: [] },
  'src/workbench/generationCanvas/agent/canvasWriteTarget.ts': { why: '把快照投影成写入目标证据（只读拷贝，不写画布）', mustCall: [] },
  'src/workbench/generationCanvas/agent/storyboardPlan.ts': { why: '分镜方案的计划边（clientId 边），不是画布 edges；落画布时由 connect_nodes 工具过闸', mustCall: [] },
  'src/workbench/generationCanvas/runner/generationRunController.ts': { why: '把当前 edges 原样交给只读解析（对象字面量形态），不写画布', mustCall: [] },
  'src/workbench/project/projectCategoryMigration.ts': { why: '加载迁移：重映射已有边的分类，不造新边', mustCall: [] },
  'src/workbench/project/projectV51ToV60Migration.ts': { why: '加载迁移：referenceImageUrls 还原成边，属于旧数据升级，不是用户新建', mustCall: [] },
}

/** 自己不直接写 `.edges`、但整条边必须经 appendAdmittedEdges 落地的文件（名单里少一个 = 又多一扇没过闸的门）。 */
export const EDGE_APPEND_CALLERS = ['src/workbench/generationCanvas/store/canvasGroupMoveActions.ts']

/** 整批追加写法：只有恢复类门（canvasDocumentCommit）与过闸落点（canvasEdgeWrite）、headless 连边（push 前已 validateReferenceEdge）可以用。 */
const APPEND_ALLOWED = new Set([
  'src/workbench/generationCanvas/store/canvasEdgeWrite.ts',
  'src/workbench/generationCanvas/store/canvasDocumentCommit.ts',
  'electron/capabilityCore/canvasGraph.ts',
  'electron/capabilityCore/dispatcher.ts', // MCP 撤销删除：放回原有边（restoredEdgeIds）
  'src/workbench/generationCanvas/events/canvasEventReducer.ts', // 事件重放
])

const MUTATORS = new Set(['push', 'unshift', 'splice', 'pop', 'shift', 'fill', 'copyWithin', 'reverse', 'sort'])
const SETTER_CALLEES = new Set(['set', 'setState', 'assign'])

/** 这个表达式是不是在取名叫 edges 的属性：x.edges / x['edges']。 */
function isEdgesAccess(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'edges'
  if (ts.isElementAccessExpression(node)) return ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'edges'
  return false
}

function propertyNameText(name) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null
}

/** 数组字面量里有没有 ...x.edges（把现有边铺开再加新的 = 整批追加）。 */
function spreadsExistingEdges(node) {
  if (!ts.isArrayLiteralExpression(node)) return false
  return node.elements.some((element) => ts.isSpreadElement(element) && (isEdgesAccess(element.expression) || (ts.isIdentifier(element.expression) && element.expression.text === 'edges')))
}

function calleeName(call) {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return ''
}

/**
 * 用 TS 语法树找出一个文件里所有「写画布 edges」的写法（不靠正则，换写法绕不过）：
 * · x.edges = … / x['edges'] = …（含复合赋值）
 * · x.edges.push(…) 等原地改数组的调用
 * · 对象字面量里的 edges 属性：带 ...展开（{ ...state, edges }）或直接交给 set / setState / Object.assign 的参数
 * append = 其中属于「铺开现有边再加新边」的整批追加。
 */
export function findEdgeWrites(source, fileName = 'x.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const writes = []
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && isEdgesAccess(node.left)) {
      writes.push({ kind: 'assign', append: spreadsExistingEdges(node.right) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken })
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && MUTATORS.has(node.expression.name.text) && isEdgesAccess(node.expression.expression)) {
      writes.push({ kind: 'mutate', append: ['push', 'unshift', 'splice'].includes(node.expression.name.text) })
    } else if (ts.isObjectLiteralExpression(node)) {
      const edgesProp = node.properties.find((property) => (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && propertyNameText(property.name) === 'edges')
      if (edgesProp) {
        const cloned = node.properties.some((property) => ts.isSpreadAssignment(property))
        const handedToSetter = ts.isCallExpression(node.parent) && node.parent.arguments.includes(node) && SETTER_CALLEES.has(calleeName(node.parent))
        if (cloned || handedToSetter) writes.push({ kind: 'literal', append: ts.isPropertyAssignment(edgesProp) && spreadsExistingEdges(edgesProp.initializer) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return writes
}

function collect(root) {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full) }
      else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.[tj]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(full)
    }
  }
  for (const scanRoot of SCAN_ROOTS) walk(path.join(root, scanRoot))
  return files
}

/** 返回违规列表（空 = 过）。root 可换成临时目录给单测用。 */
export function scanEdgeWriters(root = repoRoot, writers = EDGE_WRITERS, appendCallers = EDGE_APPEND_CALLERS) {
  const violations = []
  const seen = new Set()
  for (const file of collect(root)) {
    const rel = path.relative(root, file).split(path.sep).join('/')
    const source = fs.readFileSync(file, 'utf8')
    const found = findEdgeWrites(source, file)
    if (!found.length) continue
    seen.add(rel)
    const entry = writers[rel]
    if (!entry) {
      violations.push(`${rel}: 直接写 .edges 数组，但不在写边名单里。新边只能经 appendAdmittedEdges（整条追加）/ connectNodes（单条，过 validateReferenceEdge）/ headless connectNodes 进画布；确需新门，改本门岗名单并写清它怎么过闸。`)
      continue
    }
    if (found.some((write) => write.append) && !APPEND_ALLOWED.has(rel)) {
      violations.push(`${rel}: 出现整批追加边的写法（展开现有 edges 再加新边 / push / splice，含对象字面量与 Object.assign 形态），请改走 appendAdmittedEdges。`)
    }
    if (entry.mustCall.length && !entry.mustCall.some((marker) => source.includes(marker))) {
      violations.push(`${rel}: 在写边名单里，但没有调过闸（应出现 ${entry.mustCall.join(' / ')}）。`)
    }
  }
  for (const rel of Object.keys(writers)) {
    if (!seen.has(rel)) violations.push(`${rel}: 在写边名单里，但已经不写 .edges 了——从名单里删掉它（名单只许反映现状）。`)
  }
  for (const rel of appendCallers) {
    const file = path.join(root, rel)
    if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes('appendAdmittedEdges(')) {
      violations.push(`${rel}: 应经 appendAdmittedEdges 追加整条边，但没有调用它。`)
    }
  }
  return violations
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = scanEdgeWriters()
  if (violations.length) {
    console.error(`✖ 画布写边门岗失败（${violations.length} 条）`)
    for (const message of violations) console.error(`  - ${message}`)
    process.exit(1)
  }
  console.log(`✅ 画布写边门岗：${Object.keys(EDGE_WRITERS).length} 个写边文件都在名单里且过闸`)
}
