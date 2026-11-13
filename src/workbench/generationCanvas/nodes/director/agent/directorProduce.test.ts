/**
 * 导演视图「出成片」（选项 A：只准备，不花钱）。走真画布 store、真 stage_shot 执行体（applyProposalBatch）、
 * 真预演写回（applyPreviewCaptured，与常驻 Host 同一个函数）、真挂接核心。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyProposalBatch } from '../../../agent/proposalTxn'
import { generationCanvasTools } from '../../../agent/generationCanvasTools'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { DIRECTOR_PROJECT_META_KEY } from '../model/directorNodeMeta'
import { directorPreviewSpendBlock, directorProduceState, readDirectorPreview } from '../model/directorPreviewState'
import { createDefaultProject, normalizeDirectorProject } from '../model/directorProject'
import type { DirectorProject } from '../model/directorTypes'
import { entityClips } from '../model/timeGrid'
import type { DirectorWriteDomainResult } from './applyDirectorWrite'
import { CAMERA_MOVE_ATTACHED_URL_KEY } from './attachCameraMoveToTarget'
import { applyPreviewCaptured, previewCapturePlan } from './directorPreviewCapture'
import { prepareProduceFromPreview } from './directorProduce'
import { directorWriteSemanticInputSchema } from '../../../../../../electron/shared/agentCapabilities/directorWrite'

const PLAN = {
  scene: { environment: 'day', template: 'room', tags: ['书房'] },
  actors: [
    { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
    { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
  ],
  shots: [
    { id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } },
    { id: 'close', window: [3, 6], transitionIn: 'cut', subject: 'friend', size: '中景', angle: 'three_quarter', height: 'eye', move: { kind: 'push_in' } },
  ],
}
const URL_V1 = 'nomi-local://asset/p/preview-1.mp4'
const output = { id: 'out-1', name: 'preview-output', width: 1280, height: 720, duration: 6, createdAt: 1 }

const node = (id: string) => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
const projectOf = (id: string): DirectorProject => normalizeDirectorProject(node(id)?.meta?.[DIRECTOR_PROJECT_META_KEY])

async function staged(withShot: boolean) {
  // seedance-2 有 video_ref 槽：预演应挂成参考视频
  const shot = withShot
    ? generationCanvasTools.create_nodes([{ kind: 'video', title: '镜头 1', prompt: '书房对话', position: { x: 0, y: 0 }, meta: { archetype: { id: 'seedance-2-apimart', modeId: 't2v' } } }])[0]
    : undefined
  const outcome = await applyProposalBatch([{ toolCallId: 'c1', toolName: 'create_director_plan', effectiveArgs: directorWriteSemanticInputSchema.parse({ operation: 'create_director_plan', ...(shot ? { shotNodeId: shot.id } : {}), plan: PLAN }) as unknown as Record<string, unknown> }])
  if (outcome.status !== 'committed') throw new Error('stage failed')
  const result = outcome.results[0] as Extract<DirectorWriteDomainResult, { applied: true }>
  return { shotId: shot?.id, directorNodeId: result.directorNodeId, revision: result.revision }
}

/** 与常驻 Host 同一条路：按节点此刻的工程排采帧计划 → 落盘 → 写回 ready（带渲染源指纹）。 */
function renderPreview(directorNodeId: string, url = URL_V1): void {
  const plan = previewCapturePlan(node(directorNodeId)!)
  if (!plan) throw new Error('no capture plan')
  applyPreviewCaptured(directorNodeId, plan.revision, url, 'asset-preview', output, plan.sourceFingerprint)
}

beforeEach(() => {
  const state = useGenerationCanvasStore.getState()
  for (const item of [...state.nodes]) state.deleteNode(item.id)
})

describe('3D-BOX produce: prepare only, never spend', () => {
  it('a project without playable shots is blocked and writes nothing', () => {
    const [director] = generationCanvasTools.create_nodes([{ kind: 'director', title: 'D', prompt: '', position: { x: 0, y: 0 }, meta: { [DIRECTOR_PROJECT_META_KEY]: createDefaultProject('S') } }])
    const before = JSON.stringify(useGenerationCanvasStore.getState().nodes)
    expect(prepareProduceFromPreview(director.id, projectOf(director.id))).toEqual({ kind: 'blocked', reason: 'empty' })
    expect(JSON.stringify(useGenerationCanvasStore.getState().nodes)).toBe(before)
  })

  it('while the preview is still rendering it waits (no attach, no new node), and the shot stays behind the spend gate', async () => {
    const { shotId, directorNodeId } = await staged(true)
    const count = useGenerationCanvasStore.getState().nodes.length
    expect(prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))).toEqual({ kind: 'rendering' })
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(count)
    expect(directorPreviewSpendBlock(shotId!, useGenerationCanvasStore.getState().nodes)?.reason).toBe('rendering')
  })

  it('a fresh preview on a target shot: hands back that shot, already attached as reference video', async () => {
    const { shotId, directorNodeId } = await staged(true)
    renderPreview(directorNodeId)
    const outcome = prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))
    expect(outcome).toMatchObject({ kind: 'prepared', videoNodeId: shotId, created: false, attach: 'kept' })
    expect(node(shotId!)?.meta?.referenceVideoUrls).toEqual([URL_V1])
    expect(directorPreviewSpendBlock(shotId!, useGenerationCanvasStore.getState().nodes)).toBeNull()
  })

  it('a hand edit after the preview makes it stale: produce re-renders first instead of attaching the old preview', async () => {
    const { directorNodeId } = await staged(true)
    renderPreview(directorNodeId)
    const edited = projectOf(directorNodeId)
    edited.scenes[0].cameras[0].fov += 10
    expect(directorProduceState(readDirectorPreview(node(directorNodeId)), edited, 2)).toEqual({ kind: 'needs_render' })
    useGenerationCanvasStore.getState().updateNode(directorNodeId, { meta: { ...node(directorNodeId)!.meta, [DIRECTOR_PROJECT_META_KEY]: edited } })
    expect(prepareProduceFromPreview(directorNodeId, edited)).toEqual({ kind: 'rendering' })
    expect(readDirectorPreview(node(directorNodeId))?.status).toBe('rendering')
    // 渲染好（按改过的工程）→ 再点就是最新的
    renderPreview(directorNodeId, 'nomi-local://asset/p/preview-2.mp4')
    expect(prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))).toMatchObject({ kind: 'prepared', attach: 'kept' })
  })

  it('a standalone preview (no target shot) gets a new idle video node beside the director, with the preview attached and the gate pointed at it', async () => {
    const { directorNodeId } = await staged(false)
    // 独立预演建好时不渲染（没有要挂的镜头）：第一次点 = 请求渲染
    expect(readDirectorPreview(node(directorNodeId))).toBeNull()
    expect(prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))).toEqual({ kind: 'rendering' })
    renderPreview(directorNodeId)
    const outcome = prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))
    if (outcome.kind !== 'prepared') throw new Error(`expected prepared, got ${outcome.kind}`)
    expect(outcome.created).toBe(true)
    const video = node(outcome.videoNodeId)!
    expect(video.kind).toBe('video')
    expect(video.status ?? 'idle').not.toBe('running')
    expect(video.meta?.[CAMERA_MOVE_ATTACHED_URL_KEY]).toBe(URL_V1)
    expect(video.position.x).toBeGreaterThan(node(directorNodeId)!.position.x)
    expect(readDirectorPreview(node(directorNodeId))?.targetNodeId).toBe(video.id)
    // 连点：第二次不再建节点，也不重复挂
    const again = prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))
    expect(again).toMatchObject({ kind: 'prepared', videoNodeId: video.id, created: false, attach: 'kept' })
  })

  // 超长按当前工程判（拉长 / 改短 / 记过超长又改短）见 directorPreviewTooLong.test.ts；这里只钉「出成片」挡住、不写。
  it('a project longer than the preview limit stays blocked (shorten it first)', async () => {
    const { directorNodeId } = await staged(true)
    const project = projectOf(directorNodeId)
    for (const entity of [...project.scenes[0].objects, ...project.scenes[0].cameras]) {
      for (const clip of entityClips(entity)) if (clip.endTime >= 6 - 1e-6) clip.endTime = 11
    }
    useGenerationCanvasStore.getState().updateNode(directorNodeId, { meta: { ...node(directorNodeId)!.meta, [DIRECTOR_PROJECT_META_KEY]: project } })
    const before = readDirectorPreview(node(directorNodeId))
    expect(prepareProduceFromPreview(directorNodeId, projectOf(directorNodeId))).toEqual({ kind: 'blocked', reason: 'too_long' })
    expect(readDirectorPreview(node(directorNodeId))).toEqual(before)
  })
})

// 守卫要盖住**用户真按下去的那一层**：导演台外壳里交给按钮的 onProduce 回调（DirectorEditor.tsx 的 `produce`），以及
// 从它出发、沿函数调用与导入一路能摸到的所有函数体。以前只扫 directorProduce.ts / ProduceButton.tsx 两个文件的关键字：
// V-3dbox 10-16 在回调里 viewNodeInCanvas 之前插一句 confirmAndRunNode，测试照样绿。现在按函数做静态可达：
//   · 摸到的函数体里出现花钱入口的名字 = 红（含动态 import 进来的整个模块）；
//   · 跟本文件的顶层声明、相对路径导入的具名声明（含 export { x } from 的转出、export * from）；
//   · 不跟成员调用（store.getState().x）与第三方包：花钱入口都是具名导出的函数，不住在 store 里。
const SPEND_DOORS = [
  'confirmAndRunNode', 'regenerateNodeInPlace', 'runGenerationNode', 'runGenerationNodesBatch',
  'mintSpendGrant', 'submitCanvasShotRun', 'createCanvasShotRuns', 'confirmGenerationSpend', 'runTask',
]

type ImportedName = { module: string; name: string }
type ParsedModule = {
  file: string
  source: ts.SourceFile
  imports: Map<string, ImportedName>
  declarations: Map<string, ts.Node>
  reexports: Map<string, ImportedName>
  starExports: string[]
}
const parsedModules = new Map<string, ParsedModule | null>()

function resolveModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.(m?js)$/, ''))
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && /\.(tsx?|mts)$/.test(candidate)) return candidate
  }
  return null
}

function parseModule(file: string): ParsedModule | null {
  if (parsedModules.has(file)) return parsedModules.get(file) ?? null
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const parsed: ParsedModule = { file, source, imports: new Map(), declarations: new Map(), reexports: new Map(), starExports: [] }
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.importClause && !statement.importClause.isTypeOnly) {
      const module = resolveModule(file, statement.moduleSpecifier.text)
      if (!module) continue
      const clause = statement.importClause
      if (clause.name) parsed.imports.set(clause.name.text, { module, name: 'default' })
      const bindings = clause.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) if (!element.isTypeOnly) parsed.imports.set(element.name.text, { module, name: (element.propertyName ?? element.name).text })
      }
      if (bindings && ts.isNamespaceImport(bindings)) parsed.imports.set(bindings.name.text, { module, name: '*' })
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && !statement.isTypeOnly) {
      const module = resolveModule(file, statement.moduleSpecifier.text)
      if (!module) continue
      if (!statement.exportClause) parsed.starExports.push(module)
      else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) parsed.reexports.set(element.name.text, { module, name: (element.propertyName ?? element.name).text })
      }
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      parsed.declarations.set(statement.name.text, statement)
      if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) parsed.declarations.set('default', statement)
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) parsed.declarations.set(declaration.name.text, declaration)
    }
  }
  parsedModules.set(file, parsed)
  return parsed
}

/** 从 entry 出发能摸到的花钱入口，每条带从入口到它的路径；摸不到 = []。 */
function spendDoorsReachableFrom(file: string, entry: ts.Node, label: string): string[] {
  const hits: string[] = []
  const seen = new Set<string>()
  const enter = (moduleFile: string, name: string, via: string): void => {
    const target = parseModule(moduleFile)
    if (!target || name === '*') return
    if (target.declarations.has(name) || target.imports.has(name) || target.reexports.has(name)) return follow(target, name, `${via}@${path.basename(moduleFile)}`)
    for (const star of target.starExports) enter(star, name, via)
  }
  const follow = (module: ParsedModule, name: string, via: string): void => {
    const local = module.declarations.get(name)
    if (local) return visit(module, local, `${via} → ${name}`)
    const imported = module.imports.get(name) ?? module.reexports.get(name)
    if (imported) enter(imported.module, imported.name, `${via} → ${name}`)
  }
  function visit(module: ParsedModule, node: ts.Node, trail: string): void {
    const key = `${module.file}:${node.pos}:${node.end}`
    if (seen.has(key)) return
    seen.add(key)
    // 这段函数体里拿到的「整个模块」：import * as ns 与动态 import()。它们只有被取用的那个成员（ns.x / m.x）算摸到，
    // 不把整个模块算进来——否则任何碰画布的代码都会经节点注册表的懒加载组件「摸到」生成按钮（只是被引用，没被调用）。
    const wholeModules = new Set<string>()
    for (const [, imported] of module.imports) if (imported.name === '*') wholeModules.add(imported.module)
    const walk = (child: ts.Node): void => {
      if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword && child.arguments[0] && ts.isStringLiteralLike(child.arguments[0])) {
        const target = resolveModule(module.file, child.arguments[0].text)
        if (target) wholeModules.add(target)
      }
      if (ts.isIdentifier(child)) {
        const parent = child.parent
        const isMemberName = (ts.isPropertyAccessExpression(parent) && parent.name === child) || (ts.isPropertyAssignment(parent) && parent.name === child)
        if (SPEND_DOORS.includes(child.text)) hits.push(`${trail} → ${child.text}`)
        else if (!isMemberName) follow(module, child.text, trail)
        else if (ts.isPropertyAccessExpression(parent)) for (const whole of wholeModules) enter(whole, child.text, `${trail} → import`)
      }
      ts.forEachChild(child, walk)
    }
    walk(node)
  }
  const module = parseModule(file)
  if (module) visit(module, entry, label)
  return hits
}

/** DirectorEditor.tsx 里交给「出成片」按钮的回调（ProduceControl.onProduce 就是它）。 */
function produceCallbackOf(file: string): ts.Node {
  const module = parseModule(file)
  let found: ts.Node | null = null
  const search = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'produce' && node.initializer) found = node.initializer
    ts.forEachChild(node, search)
  }
  if (module) search(module.source)
  if (!found) throw new Error('DirectorEditor.tsx 里找不到交给「出成片」的 produce 回调——改了名就同步改这条守卫，不许删')
  return found
}

describe('produce never reaches a spending door (same rule as quick-action derive, 2026-10-05)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const editorFile = path.join(here, '../DirectorEditor.tsx')

  it('the button calls exactly the produce callback the guard walks from', () => {
    expect(fs.readFileSync(editorFile, 'utf8')).toMatch(/onProduce:\s*produce\b/)
    expect(fs.readFileSync(path.join(here, '../panels/topbar/ProduceButton.tsx'), 'utf8')).toContain('onClick={control.onProduce}')
  })

  it('nothing reachable from that callback, through every function it calls across modules, is a spending door', () => {
    expect(spendDoorsReachableFrom(editorFile, produceCallbackOf(editorFile), 'DirectorEditor.produce')).toEqual([])
  })

  it('self-check: spending hidden behind a helper, a dynamic import and one more call is seen; a merely loaded module is not', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-produce-guard-'))
    try {
      fs.writeFileSync(path.join(dir, 'door.ts'), 'export function confirmAndRunNode(id: string) { return id }\nexport function relay(id: string) { return confirmAndRunNode(id) }\nexport function harmless() { return 1 }\n')
      fs.writeFileSync(path.join(dir, 'helper.ts'), "export function attach() { void import('./door').then((m) => m.relay('n')) }\nexport function load() { void import('./door').then((m) => m.harmless()) }\n")
      fs.writeFileSync(path.join(dir, 'editor.tsx'), "import { attach, load } from './helper'\nexport function Editor() { const produce = () => { attach() }; const idle = () => { load() }; return [produce, idle] }\n")
      const editor = path.join(dir, 'editor.tsx')
      expect(spendDoorsReachableFrom(editor, produceCallbackOf(editor), 'probe')).toEqual([expect.stringContaining('relay → confirmAndRunNode')])
      fs.writeFileSync(path.join(dir, 'editor2.tsx'), "import { load } from './helper'\nexport function Editor() { const produce = () => { load() }; return produce }\n")
      const editor2 = path.join(dir, 'editor2.tsx')
      expect(spendDoorsReachableFrom(editor2, produceCallbackOf(editor2), 'probe')).toEqual([])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
