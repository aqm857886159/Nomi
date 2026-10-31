// 模态输入层普查（2026-10-31，设计卡 docs/plan/2026-10-31-modal-input-priority.md ★9 A14）。
//
// 这一类的根：工作区的快捷键挂在 window 上，模态开着时没人告诉它们。规则现在只有一条（shortcutSurface.ts 的 workspaceInputSurfaceIsActive），
// 它能不能管住，取决于两件事有没有漏：
//   ① 每个模态的宿主都登记了（useModalInputLayer）。走 DesignModal 的白送；手写的要显式调一次。漏了 = 那个弹层开着时快捷键照样落到工作区。
//   ② 每个全局键盘、粘贴、指针监听都知道自己算什么。工作区命令必须经过边界；新加一个裸 window 监听，要先想清楚它是不是工作区命令。
// 判据按机制，不按字面：扫的是 AST（注释和字符串里提到不算），监听认得出别名（const w = window）和 Mantine 的 useWindowEvent。
// 新增的东西不进表就红；表里多出来的（文件已经不是这样了）也红，豁免不许过期还留着。
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../', import.meta.url)

type SourceEntry = { rel: string; source: ts.SourceFile }

function productionSources(dir: URL, base: string): SourceEntry[] {
  return (fs.readdirSync(dir, { withFileTypes: true }) as fs.Dirent[]).flatMap((entry) => {
    const rel = `${base}/${entry.name}`
    if (entry.isDirectory()) return rel === 'src/devlab' ? [] : productionSources(new URL(`${entry.name}/`, dir), rel)
    if (!/\.tsx?$/.test(entry.name) || /\.(?:test|spec)\.tsx?$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) return []
    const text = fs.readFileSync(new URL(entry.name, dir), 'utf8')
    return [{ rel, source: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, entry.name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS) }]
  })
}

const SOURCES = productionSources(SRC, 'src')

function visit(source: ts.SourceFile, onNode: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    onNode(node)
    ts.forEachChild(node, walk)
  }
  walk(source)
}

/** 这个文件从 owner 模块（可带别名）导入了哪些符号；只认解析得回 owner 的具名导入，同名的假货不算。 */
function namedImports(entry: SourceEntry, ownerModule: string): Map<string, string> {
  const imported = new Map<string, string>()
  for (const statement of entry.source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    const specifier = statement.moduleSpecifier.text.replace(/\.tsx?$/, '')
    const resolved = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(entry.rel), specifier)) : specifier
    if (resolved !== ownerModule) continue
    for (const binding of bindings.elements) imported.set(binding.name.text, (binding.propertyName ?? binding.name).text)
  }
  return imported
}

function callsImported(entry: SourceEntry, ownerModule: string, symbols: readonly string[]): boolean {
  const imported = namedImports(entry, ownerModule)
  let found = false
  visit(entry.source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return
    const original = imported.get(node.expression.text)
    if (original && symbols.includes(original)) found = true
  })
  return found
}

const callsLayerHook = (entry: SourceEntry): boolean => callsImported(entry, 'src/design/modalInputLayer', ['useModalInputLayer'])

// ── ① 模态的宿主 ──────────────────────────────────────────────────────────────

const MODAL_CLASS = /(?:^|\s)(?:fixed inset-0|fixed inset-x-0 bottom-0|fixed bottom-0 left-0 right-0|absolute inset-0 z-application-modal)(?:\s|$)|nomi-browser-dialog-root fixed/

/** 长得像模态的文件：JSX 上有 aria-modal、role="dialog|alertdialog"，或 className 是铺满整窗 / 整格的写法。 */
function modalShapedFiles(sources: readonly SourceEntry[]): string[] {
  const files = new Set<string>()
  for (const entry of sources) {
    visit(entry.source, (node) => {
      if (!ts.isJsxAttribute(node)) return
      const name = node.name.getText(entry.source)
      const value = node.initializer
      if (name === 'aria-modal') files.add(entry.rel)
      if (name === 'role' && value && ts.isStringLiteral(value) && /^(?:alert)?dialog$/.test(value.text)) files.add(entry.rel)
      if (name === 'className' && value) {
        const search = (inner: ts.Node): void => {
          if ((ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) && MODAL_CLASS.test(inner.text)) files.add(entry.rel)
          ts.forEachChild(inner, search)
        }
        search(value)
      }
    })
  }
  return [...files].sort()
}

/** 登记了输入层的手写宿主。covers：window = 铺满整窗；canvas-cell = 只盖画布那一格（portal 进 .workbench-generation__canvas）。 */
const LAYER_HOSTS: Readonly<Record<string, 'window' | 'canvas-cell'>> = {
  'src/ui/app-shell/UpdateDialog.tsx': 'window',
  'src/ui/browser/dialog/NomiBrowserDialogView.tsx': 'window',
  'src/ui/browser/prompt/BrowserPromptExtractionSettingsModal.tsx': 'window',
  'src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx': 'window',
  'src/workbench/assets/AssetPreviewDialog.tsx': 'window',
  'src/workbench/generationCanvas/components/ScreenshotCropOverlay.tsx': 'canvas-cell',
  'src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx': 'window',
  'src/workbench/generationCanvas/nodes/NodeMediaPreviewDialog.tsx': 'canvas-cell',
  'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx': 'canvas-cell',
  'src/workbench/generationCanvas/nodes/ProvenancePanel.tsx': 'window',
  'src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx': 'window',
  'src/workbench/onboarding/HandbookPanel.tsx': 'window',
  'src/workbench/onboarding/JourneyTourController.tsx': 'window',
  'src/workbench/onboarding/SplashIntro.tsx': 'window',
  'src/workbench/promptLibrary/PromptPreviewOverlay.tsx': 'window',
  'src/workbench/settings/SettingsDialog.tsx': 'window',
  'src/workbench/timeline/TimelineShortcutsDialog.tsx': 'window',
}

/** 长得像模态、但不登记的：每条写清为什么它开着时工作区仍然该接输入，或者为什么已经被别的层盖着。 */
const NOT_A_LAYER: Readonly<Record<string, string>> = {
  'src/ui/browser/overlay/BrowserAssetOverlayApp.tsx': '浏览器素材盒的独立透明窗口，根元素铺满自己那个窗口；那里没有工作区面，模块实例也和主窗口不是一份',
  'src/ui/browser/popover/BrowserAssetPopoverParts.tsx': '浏览器窗口里的素材盒面板，开着时用户还在网页和素材盒之间操作；外层浏览器对话框已登记',
  'src/ui/browser/popover/BrowserAssetPopoverView.tsx': '同上，素材盒主体，外层浏览器对话框已登记',
  'src/ui/onboarding/IntegrationSelfCheckPanel.tsx': '唯一调用者是 OnboardingDrawer，它在设置对话框里，设置那层已经盖着工作区',
  'src/workbench/assets/AssetLibraryPanelParts.tsx': '素材库筛选 / 找参考的锚定面板，非模态，点外面就收',
  'src/workbench/generationCanvas/components/CanvasControlsHelpPopover.tsx': '画布操作说明的锚定小卡，非模态',
  'src/workbench/generationCanvas/nodes/ClipNode.tsx': '剪辑节点的浮动导出菜单，非模态，点外面就收',
  'src/workbench/generationCanvas/nodes/GridSplitPicker.tsx': '节点上的宫格拆分选择器，非模态',
  'src/workbench/generationCanvas/nodes/NodeEffectChips.tsx': '生成框里的效果小面板，非模态',
  'src/workbench/generationCanvas/nodes/NodeVideoClipPanel.tsx': '挂在节点下面的裁剪条，画布其余部分还露着，非模态',
  'src/workbench/generationCanvas/nodes/PanoramaViewer.tsx': '页格内的层，页层合同写明「不是盖住整窗的模态」（generation/pageLayer.tsx）；键盘经宿主边界',
  'src/workbench/generationCanvas/nodes/director/panels/Popover.tsx': '导演台浮层原语，非模态；导演台自己的 Esc 归属链管它',
  'src/workbench/generationCanvas/spend/AnchorCheckpointCard.tsx': '形象确认卡的放大看图，只活在 SpendConfirmDialog 里面，外层付费确认卡已登记',
  'src/workbench/library/ProjectSyncBadge.tsx': '项目卡上的同步状态小卡，非模态；项目库没有工作区面',
  'src/workbench/onboarding/OnboardingSpotlight.tsx': '教学聚光灯：高亮区要让用户真的操作工作区，不是模态',
  'src/workbench/taskCenter/TaskCenterPanel.tsx': '任务中心右侧面板，画布还露着还能操作，非模态',
  'src/workbench/timeline/TimelineTransitionPicker.tsx': '时间轴转场的锚定选择器，非模态',
}

describe('模态输入层普查：模态的宿主', () => {
  const shaped = modalShapedFiles(SOURCES)

  it('普查对象非空：扫得到已知的模态写法（判据不能在空集合上恒真）', () => {
    expect(shaped).toEqual(expect.arrayContaining(['src/workbench/settings/SettingsDialog.tsx', 'src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx', 'src/workbench/generationCanvas/nodes/NodeMediaPreviewDialog.tsx']))
  })

  it('每个长得像模态的文件都已分类：要么登记了输入层，要么写清了为什么不算', () => {
    const classified = new Set([...Object.keys(LAYER_HOSTS), ...Object.keys(NOT_A_LAYER)])
    expect(shaped.filter((file) => !classified.has(file)),
      '新模态：调 useModalInputLayer(opened) 登记（只盖一块的传 covers），否则它开着时快捷键会落到工作区；确实不是模态的，在 NOT_A_LAYER 写清理由').toEqual([])
  })

  it('LAYER_HOSTS 里的每个文件真的调了 useModalInputLayer（只认从 design/modalInputLayer 导入的）', () => {
    const missing = Object.keys(LAYER_HOSTS).filter((file) => {
      const entry = SOURCES.find((candidate) => candidate.rel === file)
      return !entry || !callsLayerHook(entry)
    })
    expect(missing).toEqual([])
  })

  it('只盖画布格的宿主把盖住的那一格传给 covers；整窗宿主不传', () => {
    for (const [file, scope] of Object.entries(LAYER_HOSTS)) {
      const entry = SOURCES.find((candidate) => candidate.rel === file)
      if (!entry) continue
      const imported = namedImports(entry, 'src/design/modalInputLayer')
      visit(entry.source, (node) => {
        if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || imported.get(node.expression.text) !== 'useModalInputLayer') return
        expect(node.arguments.length, `${file} 的 covers`).toBe(scope === 'canvas-cell' ? 2 : 1)
      })
    }
  })

  it('NOT_A_LAYER 没有过期：文件还长得像模态，也没有其实已经登记', () => {
    const stale = Object.keys(NOT_A_LAYER).filter((file) => {
      const entry = SOURCES.find((candidate) => candidate.rel === file)
      return !entry || !shaped.includes(file) || callsLayerHook(entry)
    })
    expect(stale).toEqual([])
    for (const reason of Object.values(NOT_A_LAYER)) expect(reason.length).toBeGreaterThanOrEqual(12)
  })

  it('Mantine Modal 只有 DesignModal 一个入口，它登记了输入层；Drawer 只有一处，且是不带遮罩的非模态', () => {
    const importers = (symbol: string): string[] => SOURCES.filter(({ source }) => source.statements.some((statement) =>
      ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === '@mantine/core'
      && statement.importClause?.namedBindings !== undefined && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some((binding) => (binding.propertyName ?? binding.name).text === symbol))).map(({ rel }) => rel)
    expect(importers('Modal')).toEqual(['src/design/overlays.tsx'])
    const overlays = SOURCES.find(({ rel }) => rel === 'src/design/overlays.tsx')
    expect(overlays && callsImported(overlays, 'src/design/modalInputLayer', ['useModalInputLayer'])).toBe(true)
    expect(importers('Drawer')).toEqual(['src/ui/app-shell/shell/ShellRail.tsx'])
    expect(SOURCES.find(({ rel }) => rel === 'src/ui/app-shell/shell/ShellRail.tsx')?.source.getFullText()).toContain('withOverlay={false}')
  })
})

// ── ② 全局键盘、粘贴、指针监听 ──────────────────────────────────────────────────

const INPUT_EVENTS = /^(?:key(?:down|up|press)|paste|copy|cut|pointer(?:down|move|up|cancel)|mouse(?:down|move|up)|click|dblclick|contextmenu|touch(?:start|move|end)|dragstart|drop)$/
const GLOBAL_RECEIVER = /^(?:window|document|globalThis|self)$|^window\.document$|\.ownerDocument$|^windowTarget$/
const BOUNDARY_SYMBOLS = ['shortcutSurfaceMayHandle', 'workspaceInputSurfaceIsActive', 'canvasLayerMayHandleInput'] as const

/** 每个文件里挂在全局上的输入监听（不含经 canvasWindowInput / canvasDocumentInput 的：那两个本身就是边界）。 */
function globalInputListeners(sources: readonly SourceEntry[]): Record<string, string[]> {
  const found: Record<string, Set<string>> = {}
  const add = (rel: string, type: string): void => { (found[rel] ??= new Set()).add(type) }
  for (const entry of sources) {
    const aliases = new Set<string>()
    visit(entry.source, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && GLOBAL_RECEIVER.test(node.initializer.getText(entry.source))) aliases.add(node.name.text)
    })
    visit(entry.source, (node) => {
      if (!ts.isCallExpression(node)) return
      const callee = node.expression
      const type = node.arguments[0]
      if (ts.isIdentifier(callee) && (callee.text === 'useWindowEvent' || callee.text === 'useDocumentEvent') && type && ts.isStringLiteralLike(type) && INPUT_EVENTS.test(type.text)) add(entry.rel, type.text)
      if (ts.isIdentifier(callee) && callee.text === 'useHotkeys') add(entry.rel, 'useHotkeys')
      if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'addEventListener' || !type || !ts.isStringLiteralLike(type) || !INPUT_EVENTS.test(type.text)) return
      const receiver = callee.expression.getText(entry.source)
      if (GLOBAL_RECEIVER.test(receiver) || aliases.has(receiver)) add(entry.rel, type.text)
    })
  }
  return Object.fromEntries(Object.entries(found).map(([rel, types]) => [rel, [...types].sort()]))
}

type ListenerRole =
  /** 工作区命令：必须读边界（下面的测试按导入核）。 */
  | 'boundary'
  /** 属于某个模态、菜单或弹层自己：只管它自己开着时的 Esc / 点外面，不是工作区命令。 */
  | 'own-layer'
  /** 只记状态，不执行用户命令。 */
  | 'state'
  /** 窗口级命令，和工作区内容无关。 */
  | 'window-command'
  /** 浏览器子窗口或它的面板，不在工作区面上。 */
  | 'browser'

const GLOBAL_LISTENERS: Readonly<Record<string, { role: ListenerRole; why: string }>> = {
  'src/design/AnchoredPopover.tsx': { role: 'own-layer', why: '浮层自己的 Esc' },
  'src/design/outsidePress.ts': { role: 'own-layer', why: '点外面收起的原语' },
  'src/design/useOverlayEscape.ts': { role: 'own-layer', why: '手写弹层的 Esc 原语，有 hasOpenDialogAbove 仲裁' },
  'src/ui/app-shell/shell/ShellAgentHost.tsx': { role: 'boundary', why: 'Mod+J / Mod+\\ 是整窗命令，整窗模态开着时不响应' },
  'src/ui/app-shell/shell/ShellRail.tsx': { role: 'own-layer', why: '抽屉自己的 Esc；抽屉是非模态，上面有弹层时按 DOM 让路（含菜单和非模态对话框，比输入层宽）' },
  'src/ui/browser/dialog/NomiBrowserDialog.tsx': { role: 'browser', why: '浏览器对话框自己的键；对话框本身已登记输入层' },
  'src/ui/browser/overlay/BrowserAssetOverlayApp.tsx': { role: 'browser', why: '素材盒独立窗口' },
  'src/ui/browser/popover/NomiBrowserAssetPopover.tsx': { role: 'browser', why: '素材盒自己的 Esc' },
  'src/ui/browser/popover/useBrowserAssetActions.ts': { role: 'browser', why: '素材盒里的 Delete / Cmd+A，只在素材盒开着、有选中时生效，不碰工作区' },
  'src/ui/browser/window/useResizableFloatingWindow.ts': { role: 'browser', why: '拖动素材盒窗口边的手势' },
  'src/ui/input/heldModifierReconciler.ts': { role: 'state', why: '记修饰键按住状态，不执行命令' },
  'src/ui/onboarding/ModelSettingsDetailDialog.tsx': { role: 'own-layer', why: '模型详情对话框自己的 Esc' },
  'src/ui/onboarding/useModelSettingsPageFocus.ts': { role: 'state', why: '记打开页面的触发元素，用来还焦点' },
  'src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx': { role: 'own-layer', why: '工作流设置页自己的 Esc' },
  'src/ui/onboarding/workflowPage/WorkflowNodeMenu.tsx': { role: 'own-layer', why: '菜单自己的 Esc' },
  'src/workbench/ai/ProjectAgentResidentShell.tsx': { role: 'own-layer', why: 'Agent 面板弹层点外面收起' },
  'src/workbench/assets/AssetLibraryPanel.tsx': { role: 'own-layer', why: '素材库筛选菜单自己的 Esc' },
  'src/workbench/assets/AssetPreviewDialog.tsx': { role: 'own-layer', why: '素材预览自己的 Esc 和翻页' },
  'src/workbench/creation/DocumentListSidebar.tsx': { role: 'own-layer', why: '文稿右键菜单自己的 Esc / 点外面' },
  'src/workbench/generation/list/GenerationListView.tsx': { role: 'boundary', why: '列表详情的 Esc' },
  'src/workbench/generationCanvas/components/ScreenshotCropOverlay.tsx': { role: 'boundary', why: '灯箱自己的 Esc：画布宿主活动且自己在最上面才接' },
  'src/workbench/generationCanvas/components/canvasDropActiveFlag.ts': { role: 'state', why: '记拖放进行中，不执行命令' },
  'src/workbench/generationCanvas/components/useCanvasContextNodeMenu.ts': { role: 'state', why: '指针被系统取消时清掉待开的菜单状态' },
  'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx': { role: 'boundary', why: '参数面板的外点和 Esc' },
  'src/workbench/generationCanvas/nodes/NodeMediaPreviewDialog.tsx': { role: 'boundary', why: '灯箱自己的 Esc 和方向键：画布宿主活动且自己在最上面才接' },
  'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx': { role: 'boundary', why: '灯箱自己的 Esc：画布宿主活动且自己在最上面才接' },
  'src/workbench/onboarding/HandbookPanel.tsx': { role: 'own-layer', why: '手册自己的 Esc' },
  'src/workbench/onboarding/OnboardingSpotlight.tsx': { role: 'own-layer', why: '教学聚光灯自己的 Esc / 外点' },
  'src/workbench/preview/EditingLayoutMenu.tsx': { role: 'own-layer', why: '布局菜单自己的 Esc' },
  'src/workbench/preview/PreviewWorkspace.tsx': { role: 'boundary', why: '面板布局撤销' },
  'src/workbench/project/useProjectWindowLifecycle.ts': { role: 'window-command', why: '窗口硬刷新前先存盘，和有没有弹层无关' },
  'src/workbench/promptLibrary/PromptPreviewOverlay.tsx': { role: 'own-layer', why: '提示词预览自己的 Esc' },
  'src/workbench/settings/SettingsDialog.tsx': { role: 'own-layer', why: '设置对话框自己的 Esc' },
  'src/workbench/sidebar/CategoryTree.tsx': { role: 'own-layer', why: '分类树右键菜单自己的 Esc / 点外面' },
  'src/workbench/taskCenter/TaskCenterPanel.tsx': { role: 'own-layer', why: '任务中心自己的 Esc' },
  'src/workbench/timeline/TimelinePanel.tsx': { role: 'boundary', why: '时间轴快捷键和帮助键' },
  'src/workbench/timeline/TimelineShortcutsDialog.tsx': { role: 'own-layer', why: '帮助框自己的 ?，自己在最上面才接' },
  'src/workbench/timeline/timelineGesture.ts': { role: 'boundary', why: '片段拖动手势，面失权就打断' },
}

describe('模态输入层普查：全局键盘、粘贴、指针监听', () => {
  const listeners = globalInputListeners(SOURCES)

  it('普查对象非空，并且认得出 Mantine 的 useWindowEvent 和传进来的 window', () => {
    expect(Object.keys(listeners)).toEqual(expect.arrayContaining(['src/workbench/timeline/TimelinePanel.tsx', 'src/ui/app-shell/shell/ShellRail.tsx', 'src/ui/input/heldModifierReconciler.ts']))
  })

  it('每个全局输入监听都已分类；表里没有过期的', () => {
    expect(Object.keys(listeners).sort(),
      '新的全局输入监听：工作区命令请用 canvasWindowInput 或读 shortcutSurfaceMayHandle / workspaceInputSurfaceIsActive；不是工作区命令的，在 GLOBAL_LISTENERS 写清它算什么').toEqual(Object.keys(GLOBAL_LISTENERS).sort())
  })

  it('role=boundary 的文件真的读了边界（只认从 shortcutSurface / modalInputLayer 导入的）', () => {
    const bypass = Object.entries(GLOBAL_LISTENERS).filter(([, { role }]) => role === 'boundary').map(([file]) => file).filter((file) => {
      const entry = SOURCES.find((candidate) => candidate.rel === file)
      if (!entry) return true
      return !callsImported(entry, 'src/workbench/shortcutSurface', BOUNDARY_SYMBOLS) && !callsImported(entry, 'src/design/modalInputLayer', ['modalInputLayerCovers'])
    })
    expect(bypass).toEqual([])
  })

  it('经 canvasWindowInput / canvasDocumentInput 的监听只能从 shortcutSurface 拿到（同名假货不算边界）', () => {
    const fakes = SOURCES.filter((entry) => {
      if (entry.rel === 'src/workbench/shortcutSurface.ts') return false
      let declares = false
      visit(entry.source, (node) => {
        if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name) && /^canvas(?:Window|Document)Input$/.test(node.name.text)) declares = true
      })
      return declares
    }).map(({ rel }) => rel)
    expect(fakes).toEqual([])
  })
})
