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
// 租户目录里每个 window / document 键盘监听所在的文件，要么读 useGenerationPageLayerActive、要么登记豁免并写明理由。
// 画布格的第二种找法（document.querySelector('.workbench-generation__canvas')）只许三处存量灯箱，只减不增。
import fs from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

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
  lifecycle: string
  /** 租户目录 / 文件：这里面的 window / document 键盘监听要么读 useGenerationPageLayerActive，要么登记豁免。 */
  keyboardRoot: string
}

/** 页格内的层：经 GenerationPageLayer 挂进生成页画布那一格，不是 body portal。 */
const PAGE_CELL_TENANTS: Readonly<Record<string, PageCellEntry>> = {
  'src/workbench/generationCanvas/nodes/director/DirectorNode.tsx': {
    keyboardRoot: 'src/workbench/generationCanvas/nodes/director',
    lifecycle: '`open` 是节点本地 state（事实一份）。层随生成页槽位一起 display:none（切去创作 / 预览、列表视图），回来原样还在；退出确认 / 节点卸载 / 回项目库（整个工作台卸载）才没。藏着时键盘监听、3D 渲染循环、暗色锁、录制中的运镜由层里各处读 useGenerationPageLayerActive 停掉。',
  },
  'src/workbench/generationCanvas/nodes/PanoramaViewer.tsx': {
    keyboardRoot: 'src/workbench/generationCanvas/nodes/PanoramaViewer.tsx',
    lifecycle: '`fullscreen` 是节点内本地 state。同上随生成页藏 / 回；藏着时 Esc 与 psv 的键盘控制（keyboard:\'always\' 挂在 window 上）都停。',
  },
}

/** 租户目录里 window / document 键盘监听的豁免：只允许「按需出现的浮层」，且要写明为什么切页时它不会留着吞键。 */
const KEYBOARD_LISTENER_EXEMPT: Readonly<Record<string, string>> = {
  'src/workbench/generationCanvas/nodes/director/panels/Popover.tsx': '按需出现的浮层：监听只在浮层开着时挂；切页必须先点顶栏，那一下是浮层的外点（document 捕获期 pointerdown），浮层先收、监听随之摘掉。',
  'src/workbench/generationCanvas/nodes/director/timeline/TimelineContextMenu.tsx': '按需出现的右键菜单：同上，外点 / Esc 关闭，监听只在菜单开着时挂。',
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

/** 挂在 window / document 上的键盘监听（keydown / keyup / keypress）所在的文件。 */
function keyboardListenerFiles(sources: readonly SourceFileEntry[]): string[] {
  const files = new Set<string>()
  for (const { rel, source } of sources) {
    visit(source, (node) => {
      if (!ts.isCallExpression(node) || calleeName(node) !== 'addEventListener' || !ts.isPropertyAccessExpression(node.expression)) return
      const target = node.expression.expression.getText(source)
      const type = node.arguments[0]
      if ((target === 'window' || target === 'document') && type && ts.isStringLiteralLike(type) && /^key(?:down|up|press)$/.test(type.text)) files.add(rel)
    })
  }
  return [...files].sort()
}

const readsLayerActive = ({ source }: SourceFileEntry): boolean => {
  let found = false
  visit(source, (node) => {
    if (ts.isIdentifier(node) && node.text === 'useGenerationPageLayerActive') found = true
  })
  return found
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

  it('每个租户写了生命周期，租户目录里的 window / document 键盘监听都跟着「这一格看不看得见」', () => {
    for (const [file, entry] of Object.entries(PAGE_CELL_TENANTS)) {
      expect(entry.lifecycle.length, `${file} 的生命周期说明太短`).toBeGreaterThanOrEqual(20)
      const inRoot = SOURCES.filter(({ rel }) => rel === entry.keyboardRoot || rel.startsWith(`${entry.keyboardRoot}/`))
      expect(inRoot.length, `${file} 的键盘监听扫描根找不到文件：${entry.keyboardRoot}`).toBeGreaterThan(0)
      const listeners = keyboardListenerFiles(inRoot)
      expect(listeners.length, `${entry.keyboardRoot} 里扫不到任何 window / document 键盘监听（判据不能恒真）`).toBeGreaterThan(0)
      const ungated = listeners.filter((rel) => {
        const sourceEntry = inRoot.find((candidate) => candidate.rel === rel)
        return !(sourceEntry && readsLayerActive(sourceEntry)) && !(rel in KEYBOARD_LISTENER_EXEMPT)
      })
      expect(
        ungated,
        '页格内的层藏着（切页 / 列表视图）时，挂在 window / document 上的键盘监听不能留着（会吞掉别的页的 Esc / 快捷键）：'
          + '读 useGenerationPageLayerActive 在藏着时摘掉，或在 KEYBOARD_LISTENER_EXEMPT 登记「按需出现的浮层」并写明理由',
      ).toEqual([])
    }
  })

  it('豁免只给扫得到、且确实没读 useGenerationPageLayerActive 的文件（豁免不许过期）', () => {
    const all = keyboardListenerFiles(SOURCES)
    for (const file of Object.keys(KEYBOARD_LISTENER_EXEMPT)) {
      expect(all, `${file} 已经没有 window / document 键盘监听了，豁免该删`).toContain(file)
      const entry = SOURCES.find(({ rel }) => rel === file)
      expect(entry && readsLayerActive(entry), `${file} 已经读了 useGenerationPageLayerActive，豁免该删`).toBe(false)
    }
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

  it('读 useGenerationPageLayerActive 的文件被认出来，没读的不算', () => {
    expect(readsLayerActive(parse('g.tsx', 'const active = useGenerationPageLayerActive()'))).toBe(true)
    expect(readsLayerActive(parse('h.tsx', '// useGenerationPageLayerActive 只出现在注释里\nconst active = true'))).toBe(false)
  })
})

