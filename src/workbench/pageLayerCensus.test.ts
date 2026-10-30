// 页内全屏层普查（2026-10-29；导演台「右边漏画布、点创作 / 预览出不去、小球被盖」那一类的门岗，方向检查
// docs/plan/2026-10-29-director-layer-in-page.direction-check.md，设计卡 ★9 第 10 条）。
//
// 那一类的根：全屏编辑器 / 查看器图方便 `createPortal(…, document.body)`，于是它们自己算「我占窗口哪一块」（右边留多少、顶偏移）、
// 靠节点本地 state 管「什么时候消失」——外壳一变（10-08 Agent 三形态）就错位，切页就出不去。
// 门岗此前只认字面量 `fixed inset-0`（windowChrome.test.ts），`fixed inset-x-0 bottom-0` 漏网，左 / 右 / 下三边和生命周期没人守。
// 这里换成按机制判：**`src/workbench` 里每一个挂到 document.body 的 portal（createPortal(…, document.body) 与 <BodyPortal>）都要登记归属和生命周期**，
// 没登记就红；登记里多出来的（那个文件已经不是 body portal）也红。归属只有三种：
//   · shell-modal：外壳级模态 / 灯箱 / 全局对话框——不属于任何一页，层级走 NOMI_OVERLAY_Z_INDEX 刻度；
//   · anchored：锚在触发器上的菜单 / 提示 / 参数面板——不是一层，跟触发它的状态走；
//   · page-cell：页格内的层——**不是 body portal**，经 GenerationPageLayer 挂进生成页那一格（generation/pageLayer.tsx），登记在 PAGE_CELL_TENANTS。
// 页格内的层藏着（切页 / 列表视图）时挂在 window / document 上的键盘监听必须停（否则吞掉别的页的 Esc / 快捷键）：
// 租户目录的全局键盘监听统一经 shortcutSurface 的受控目标；不再保留原始 window / document 监听的局部豁免。
// 画布格的第二种找法（document.querySelector('.workbench-generation__canvas')）只许三处存量灯箱，只减不增。
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { generationPageLayerTenantsLifetime, observeGenerationPageLayerNodes, setGenerationPageLayerTenantOpen, useGenerationPageLayerTenantOpen, useGenerationPageLayerTenants, type PageLayerTenant } from './generation/pageLayerContext'
import { useGenerationCanvasStore } from './generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from './generationCanvas/model/generationCanvasTypes'

const WORKBENCH = new URL('./', import.meta.url)

type BodyPortalOwner = 'shell-modal' | 'anchored'
type BodyPortalEntry = { owner: BodyPortalOwner; count: number; lifecycle: string }

/** 挂到 document.body 的 portal（含 <BodyPortal>），按文件登记；count = 该文件里这类 portal 的处数。 */
const BODY_PORTALS: Readonly<Record<string, BodyPortalEntry>> = {
  'src/workbench/assets/AssetPreviewDialog.tsx': {
    owner: 'shell-modal', count: 1,
    lifecycle: '素材库双击放大预览（全屏 lightbox，applicationModal 档，从顶栏下沿起画）。素材库在左栏抽屉里、跨创作 / 生成 / 预览三页，所以必须在 body；开关是调用方的本地 state，点背景 / ✕ / Esc 关，随调用方卸载（切项目）一起没。',
  },
  'src/workbench/assets/AssetTile.tsx': {
    owner: 'anchored', count: 2,
    lifecycle: '素材块 hover 小提示与放大预览（pointer-events-none，不接键盘）：跟 hover 状态出现和消失，鼠标一离开就没。',
  },
  'src/workbench/creation/DocumentListSidebar.tsx': {
    owner: 'anchored', count: 1,
    lifecycle: '文稿 / 方案行右键菜单（fixed，popover 档）：菜单开关是组件本地 state，选一项 / 点外面 / 侧栏卸载就收。',
  },
  'src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx': {
    owner: 'shell-modal', count: 1,
    lifecycle: '画布选中文字后的「存为提示词」小钮 + 居中保存对话框（居中遮罩，存量手写层级见 scripts/overlay-z-baseline.json）：控制器挂一次、状态是它自己的本地 state，点背景 / ✕ / 保存成功就收。',
  },
  'src/workbench/generationCanvas/nodes/ClipNode.tsx': {
    owner: 'anchored', count: 2,
    lifecycle: '剪辑节点的浮动工具层与导出菜单（fixed，按节点锚点定位）：节点本地 state，点外面 / 节点卸载就收。',
  },
  'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx': {
    owner: 'anchored', count: 1,
    lifecycle: '节点参数面板（fixed，按触发器定位）：本地 state，点外面 / 节点卸载就收。',
  },
  'src/workbench/generationCanvas/nodes/director/panels/Popover.tsx': {
    owner: 'anchored', count: 1,
    lifecycle: '导演台浮层原语（BodyPortal + fixed，popover 档）：外点关闭、捕获期 Esc 关闭；用户要切页必须先点顶栏，那一下就是浮层的外点，浮层先收掉。',
  },
  'src/workbench/generationCanvas/nodes/director/timeline/TimelineContextMenu.tsx': {
    owner: 'anchored', count: 1,
    lifecycle: '导演台时间轴右键菜单（BodyPortal + fixed，popover 档）：外点 / Esc 关闭，同上。',
  },
  'src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx': {
    owner: 'shell-modal', count: 1,
    lifecycle: '全局花钱确认卡（BodyPortal，dialog 档）：由任务 / 门岗的请求驱动、挂在公共根，不属于任何一页；用户点确认 / 取消才收。',
  },
}

type PageCellEntry = {
  tenant: PageLayerTenant
  lifecycle: string
  /** 租户目录 / 文件：这里面的全局键盘监听只经共享宿主权限边界。 */
  keyboardRoot: string
}

/** 页格内的层：经 GenerationPageLayer 挂进生成页画布那一格，不是 body portal。 */
const PAGE_CELL_TENANTS: Readonly<Record<string, PageCellEntry>> = {
  'src/workbench/generationCanvas/nodes/director/DirectorNode.tsx': {
    tenant: 'director',
    keyboardRoot: 'src/workbench/generationCanvas/nodes/director',
    lifecycle: '打开状态归页格层按节点 id 保存；节点组件裁剪 / 重挂不清。关导演台、删节点或释放项目才清；切页 / 列表只隐藏，键盘监听、3D 渲染、暗色锁与录运镜读 active 停掉。',
  },
  'src/workbench/generationCanvas/nodes/PanoramaViewer.tsx': {
    tenant: 'panorama',
    keyboardRoot: 'src/workbench/generationCanvas/nodes/PanoramaViewer.tsx',
    lifecycle: '打开状态归页格层按节点 id 保存；节点组件裁剪 / 重挂不清。Esc、删节点或释放项目才清；切页 / 列表只隐藏，藏着时 Esc 与 psv 键盘控制都停。',
  },
}

/** 画布格的第二种找法（按 class 名查 DOM）：三处存量灯箱（行为是盖住 Agent 的模态），只减不增；新层请经 GenerationPageLayer。 */
const LEGACY_CELL_QUERY_FILES: readonly string[] = [
  'src/workbench/generationCanvas/components/ScreenshotCropOverlay.tsx',
  'src/workbench/generationCanvas/nodes/NodeMediaPreviewDialog.tsx',
  'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx',
]

type SourceFileEntry = { rel: string; source: ts.SourceFile }

function productionSources(dir: URL, base: string): SourceFileEntry[] {
  return (fs.readdirSync(dir, { withFileTypes: true }) as fs.Dirent[]).flatMap((entry) => {
    const rel = `${base}/${entry.name}`
    if (entry.isDirectory()) return productionSources(new URL(`${entry.name}/`, dir), rel)
    if (!/\.tsx?$/.test(entry.name) || /\.(?:test|spec)\.tsx?$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) return []
    const text = fs.readFileSync(new URL(entry.name, dir), 'utf8')
    return [{ rel, source: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, entry.name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS) }]
  })
}

const SOURCES = productionSources(WORKBENCH, 'src/workbench')

function visit(source: ts.SourceFile, onNode: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    onNode(node)
    ts.forEachChild(node, walk)
  }
  walk(source)
}

const calleeName = (call: ts.CallExpression): string | null => {
  const expression = call.expression
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return null
}

/** 每个文件里挂到 document.body 的 portal 处数：`createPortal(x, document.body)` 与 JSX `<BodyPortal>`。 */
function bodyPortalCounts(sources: readonly SourceFileEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const { rel, source } of sources) {
    visit(source, (node) => {
      const isCreatePortalToBody = ts.isCallExpression(node) && calleeName(node) === 'createPortal' && node.arguments[1]?.getText(source) === 'document.body'
      const isBodyPortalElement = (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'BodyPortal'
      if (isCreatePortalToBody || isBodyPortalElement) counts[rel] = (counts[rel] ?? 0) + 1
    })
  }
  return counts
}

/** 用了 `<GenerationPageLayer>` 的文件（页格内的层的租户）。 */
function pageCellTenantFiles(sources: readonly SourceFileEntry[]): string[] {
  const files = new Set<string>()
  for (const { rel, source } of sources) {
    visit(source, (node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'GenerationPageLayer') files.add(rel)
    })
  }
  return [...files].sort()
}

/** 按 class 名找画布格：`querySelector('.workbench-generation__canvas')`。 */
function cellQueryFiles(sources: readonly SourceFileEntry[]): string[] {
  const files = new Set<string>()
  for (const { rel, source } of sources) {
    visit(source, (node) => {
      if (ts.isCallExpression(node) && calleeName(node) === 'querySelector' && /workbench-generation__canvas/.test(node.arguments[0]?.getText(source) ?? '')) files.add(rel)
    })
  }
  return [...files].sort()
}

/** 全局键盘监听的真实 owner：只认可解析回共享 shortcutSurface 的具名导入（含别名）。 */
function keyboardListenerOwnership(sources: readonly SourceFileEntry[]): Record<string, boolean> {
  const ownership: Record<string, boolean> = {}
  for (const { rel, source } of sources) {
    const targets = new Map([['window', false], ['document', false], ['canvasWindowInput', false], ['canvasDocumentInput', false]])
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      const owner = path.posix.normalize(path.posix.join(path.posix.dirname(rel), statement.moduleSpecifier.text.replace(/\.tsx?$/, '')))
      for (const binding of bindings.elements) {
        if (['canvasWindowInput', 'canvasDocumentInput'].includes((binding.propertyName ?? binding.name).text)) {
          targets.set(binding.name.text, owner === 'src/workbench/shortcutSurface')
        }
      }
    }
    visit(source, (node) => {
      if (!ts.isCallExpression(node) || calleeName(node) !== 'addEventListener' || !ts.isPropertyAccessExpression(node.expression)) return
      const target = node.expression.expression.getText(source)
      const type = node.arguments[0]
      if (!targets.has(target) || !type || !ts.isStringLiteralLike(type) || !/^key(?:down|up|press)$/.test(type.text)) return
      ownership[rel] = (ownership[rel] ?? true) && targets.get(target) === true
    })
  }
  return ownership
}

function keyboardListenerFiles(sources: readonly SourceFileEntry[]): string[] {
  return Object.keys(keyboardListenerOwnership(sources)).sort()
}

describe('页内全屏层普查：body portal 必须登记归属与生命周期', () => {
  it('普查对象非空：扫得到已登记的那些 body portal（判据不能在空集合上恒真）', () => {
    const counts = bodyPortalCounts(SOURCES)
    expect(Object.keys(counts)).toEqual(expect.arrayContaining(['src/workbench/assets/AssetPreviewDialog.tsx', 'src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx']))
  })

  it('src/workbench 里每个挂到 document.body 的 portal 都已登记，处数对得上，没有多登记的', () => {
    const found = bodyPortalCounts(SOURCES)
    const registered = Object.fromEntries(Object.entries(BODY_PORTALS).map(([file, entry]) => [file, entry.count]))
    expect(
      found,
      '有 body portal 没登记（或处数变了）：全屏编辑器 / 查看器 / 面板这类「页面里的一块」不要挂 body——经 GenerationPageLayer（generation/pageLayer.tsx）挂进生成页那一格；'
        + '确属外壳级模态或锚定浮层的，在 BODY_PORTALS 登记归属与生命周期。登记里多出来的，说明那个文件已经不是 body portal，该删',
    ).toEqual(registered)
  })

  it('每条登记都写了生命周期（谁开、谁关、切页 / 卸载时怎么办）', () => {
    for (const [file, entry] of Object.entries(BODY_PORTALS)) {
      expect(entry.lifecycle.length, `${file} 的生命周期说明太短`).toBeGreaterThanOrEqual(20)
      expect(['shell-modal', 'anchored']).toContain(entry.owner)
    }
  })
})

describe('页内全屏层普查：页格内的层只经 GenerationPageLayer 挂载', () => {
  it('用了 <GenerationPageLayer> 的文件恰好是登记的租户（导演台、全景查看器）', () => {
    expect(pageCellTenantFiles(SOURCES)).toEqual(Object.keys(PAGE_CELL_TENANTS).sort())
  })

  it('租户不是 body portal：页格内的层和 body 层是两种归属，不并存', () => {
    const found = bodyPortalCounts(SOURCES)
    for (const file of Object.keys(PAGE_CELL_TENANTS)) expect(found[file], `${file} 既是页格内租户又挂 body`).toBeUndefined()
  })

  it('每个租户的全局键盘监听都经共享输入权限边界，不保留局部豁免', () => {
    for (const [file, entry] of Object.entries(PAGE_CELL_TENANTS)) {
      expect(entry.lifecycle.length, `${file} 的生命周期说明太短`).toBeGreaterThanOrEqual(20)
      const inRoot = SOURCES.filter(({ rel }) => rel === entry.keyboardRoot || rel.startsWith(`${entry.keyboardRoot}/`))
      expect(inRoot.length, `${file} 的键盘扫描根不存在`).toBeGreaterThan(0)
      const ownership = keyboardListenerOwnership(inRoot)
      expect(Object.keys(ownership).length, `${entry.keyboardRoot} 没扫到监听，不能空集合报绿`).toBeGreaterThan(0)
      expect(Object.entries(ownership).filter(([, guarded]) => !guarded).map(([rel]) => rel),
        '页格内全局键盘监听必须使用 shortcutSurface 导出的受控目标；原始监听或同名伪 owner 都拒绝',
      ).toEqual([])
    }
  })
})

function TenantProbe({ tenant, nodeId }: { tenant: PageLayerTenant; nodeId: string }): React.ReactElement {
  return React.createElement('span', null, useGenerationPageLayerTenantOpen(tenant, nodeId) ? 'open' : 'closed')
}

describe('页格租户打开状态：节点组件重挂与删除生命周期', () => {
  it('登记的每个租户 id 唯一；新加页格层不登记就进不了这组测试', () => {
    expect(pageCellTenantFiles(SOURCES)).toEqual(Object.keys(PAGE_CELL_TENANTS).sort())
    expect(new Set(Object.values(PAGE_CELL_TENANTS).map((entry) => entry.tenant)).size).toBe(Object.keys(PAGE_CELL_TENANTS).length)
    for (const file of Object.keys(PAGE_CELL_TENANTS)) {
      const source = SOURCES.find((entry) => entry.rel === file)?.source.getFullText() ?? ''
      expect(source, `${file} 必须读页格层的唯一打开状态`).toContain('useGenerationPageLayerTenantOpen')
      expect(source, `${file} 只能向页格层发开关意图`).toContain('setGenerationPageLayerTenantOpen')
    }
  })

  for (const [file, { tenant }] of Object.entries(PAGE_CELL_TENANTS)) {
    it(`${file}：打开 → 组件卸载并重挂仍开着 → 删节点后状态清掉`, () => {
      const nodeId = `page-layer-${tenant}`
      generationPageLayerTenantsLifetime.releaseProject?.()
      useGenerationCanvasStore.setState({ nodes: [{ id: nodeId, kind: tenant, position: { x: 0, y: 0 }, status: 'idle' } as GenerationCanvasNode], edges: [], selectedNodeIds: [] })
      const stop = observeGenerationPageLayerNodes(useGenerationCanvasStore)
      try {
        setGenerationPageLayerTenantOpen(tenant, nodeId, true)
        expect(renderToStaticMarkup(React.createElement(TenantProbe, { tenant, nodeId }))).toContain('open')
        // 两次独立渲染之间探针组件已卸载；页格层的事实没有随节点组件一起卸载。
        expect(renderToStaticMarkup(React.createElement(TenantProbe, { tenant, nodeId }))).toContain('open')
        useGenerationCanvasStore.getState().deleteNode(nodeId)
        expect(renderToStaticMarkup(React.createElement(TenantProbe, { tenant, nodeId }))).toContain('closed')
        expect(useGenerationPageLayerTenants.getState().open[nodeId]).toBeUndefined()
      } finally {
        stop()
        useGenerationCanvasStore.setState({ nodes: [], edges: [], selectedNodeIds: [] })
        generationPageLayerTenantsLifetime.releaseProject?.()
      }
    })
  }

  it('项目释放清空所有租户，复用同一个节点 id 也不会继承旧项目的层', () => {
    for (const { tenant } of Object.values(PAGE_CELL_TENANTS)) setGenerationPageLayerTenantOpen(tenant, 'reused-id', true)
    generationPageLayerTenantsLifetime.releaseProject?.()
    expect(useGenerationPageLayerTenants.getState().open).toEqual({})
  })
})

describe('页内全屏层普查：画布格的第二种找法只减不增', () => {
  it('按 class 名找 .workbench-generation__canvas 的只有三处存量灯箱', () => {
    expect(
      cellQueryFiles(SOURCES),
      '新的页内层不要再按 class 名查画布格：经 GenerationPageLayer 挂载（挂载点由 GenerationWorkspace 提供并命名，唯一一处）。存量灯箱迁走后从 LEGACY_CELL_QUERY_FILES 删掉',
    ).toEqual([...LEGACY_CELL_QUERY_FILES].sort())
  })
})

describe('页内全屏层普查：判据自身不恒真（必红用例）', () => {
  const parse = (name: string, text: string): SourceFileEntry => ({ rel: name, source: ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) })

  it('createPortal 到 body、<BodyPortal>、<GenerationPageLayer>、class 查找、window 键盘监听各自被认出来，别的目标 / 事件不算', () => {
    const sample = [
      parse('a.tsx', 'const x = createPortal(<i />, document.body); const y = ReactDOM.createPortal(<i />, document.body)'),
      parse('b.tsx', 'const x = <BodyPortal><i /></BodyPortal>'),
      parse('c.tsx', 'const x = createPortal(<i />, host); const y = createPortal(<i />, scene)'),
      parse('d.tsx', 'const x = <GenerationPageLayer><i /></GenerationPageLayer>'),
      parse('e.tsx', "const x = document.querySelector('.workbench-generation__canvas'); const y = document.querySelector('.other')"),
      parse('f.tsx', "window.addEventListener('keydown', f); document.addEventListener('keyup', f); window.addEventListener('resize', f); el.addEventListener('keydown', f)"),
    ]
    expect(bodyPortalCounts(sample)).toEqual({ 'a.tsx': 2, 'b.tsx': 1 })
    expect(pageCellTenantFiles(sample)).toEqual(['d.tsx'])
    expect(cellQueryFiles(sample)).toEqual(['e.tsx'])
    expect(keyboardListenerFiles(sample)).toEqual(['f.tsx'])
  })

  it('共享 owner 的真实导入和别名可识别，原始监听、同名局部对象与假导入都不放行', () => {
    const root = 'src/workbench/generationCanvas/nodes/director/'
    const sample = [
      parse(`${root}raw.tsx`, "window.addEventListener('keydown', f)"),
      parse(`${root}local.tsx`, "const canvasWindowInput = window; canvasWindowInput.addEventListener('keydown', f)"),
      parse(`${root}wrong.tsx`, "import { canvasWindowInput as keys } from './shortcutSurface'; keys.addEventListener('keyup', f)"),
      parse(`${root}guarded.tsx`, "import { canvasWindowInput as keys } from '../../../shortcutSurface'; keys.addEventListener('keydown', f)"),
      parse(`${root}document.tsx`, "import { canvasDocumentInput } from '../../../shortcutSurface'; canvasDocumentInput.addEventListener('keyup', f)"),
    ]
    expect(keyboardListenerOwnership(sample)).toEqual({
      [`${root}raw.tsx`]: false,
      [`${root}local.tsx`]: false,
      [`${root}wrong.tsx`]: false,
      [`${root}guarded.tsx`]: true,
      [`${root}document.tsx`]: true,
    })
  })
})

