import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { describe, expect, it } from 'vitest'
import { NOMI_OVERLAY_Z_INDEX, NOMI_OVERLAY_Z_INDEX_CSS_VARS } from '../../design/overlayLayers'
import '../../i18n'
import { SplashIntro } from '../../workbench/onboarding/SplashIntro'
import { fullscreenOverlayTopOffset, workbenchFloatingTopOffset } from './windowChrome'
import { SHELL_TOPBAR_HEIGHT } from './shellGeometry'

const read = (relativePath: string): string => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('workbench floating surface top offset', () => {
  // 10-08 外壳重设计：窗口栏与应用栏合成一条 40px 顶栏，两平台同高——浮卡一律贴它下沿。
  it('clears the single 40px top bar on every platform', () => {
    expect(workbenchFloatingTopOffset()).toBe(48)
    expect(workbenchFloatingTopOffset(12)).toBe(52)
  })

  it('routes top floating surfaces through one offset', () => {
    for (const source of [
      read('../../NomiAppProviders.tsx'),
      read('../../workbench/taskCenter/TaskCenterPanel.tsx'),
    ]) {
      expect(source).toContain('currentWorkbenchFloatingTopOffset')
    }
  })
})

// issue #58（Windows v0.19.0）：Portal 浮卡右上角的 × 点中心没反应，偏上下才灵。
// 根因是 Windows frame:false + 自绘窗口栏，拖拽区靠 -webkit-app-region 命中测试划出来，
// 而命中测试**看几何、不看 DOM 层级**：Portal 到 body 的浮层不是窗口栏的后代，
// 拿不到窗口栏内那条 `.app-drag button` 豁免，压在拖拽带上的按钮点击就被系统当成拖窗口吃掉。
const PORTAL_FLOATING_SURFACES = [
  ['任务中心浮卡', '../../workbench/taskCenter/TaskCenterPanel.tsx'],
] as const

describe('Portal 浮层不被 Windows 拖拽区吃掉点击（issue #58）', () => {
  it.each(PORTAL_FLOATING_SURFACES)('%s 整体退出拖拽区', (_name, file) => {
    // 挂在根上即可：tailwind 的 `.app-no-drag *` 覆盖全部后代，关闭按钮不必单独标。
    expect(read(file)).toContain('app-no-drag')
  })

  it.each(PORTAL_FLOATING_SURFACES)('%s 的顶部偏移在渲染时现算，不在模块作用域定死', (_name, file) => {
    // 模块常量在 import 求值那一刻定死：那时若 window.nomiDesktop 还没挂上，platform 是
    // undefined → 悄悄回落成 mac 的 64px，Windows 上整张浮卡上移 32px 贴进窗口栏。
    // 这类「拿运行时输入却在模块作用域算一次」的写法，别处再犯也会以同样方式静默错位。
    expect(read(file)).not.toMatch(/^const\s+TOP_OFFSET\s*=/m)
  })
})

// 2026-09-04（导演台）：整条顶部工具栏一个按钮都点不动，且最小化/最大化/关闭够不着。
// 与 issue #58 同根、同机制，只是换了一族入口：Windows frame:false 下那条 32px 自绘窗口栏
// 是系统级拖拽带，命中测试**看几何、不看 DOM 层级**——盖在它上面的全屏浮层，顶部一条的点击
// 被系统当成拖窗口吃掉，同时把唯一那份窗口控件埋在下面。#58 当时只把浮卡标了 app-no-drag，
// 没扫这一族「铺满整窗、自带顶部操作行」的浮层，于是同一个洞从导演台又回来了。
// 类不变量：全屏浮层不覆盖窗口栏——顶偏移由 windowChrome 单口给出，各浮层不得自己写 32。
const FULLSCREEN_OVERLAYS = [
  ['导演台全屏壳', '../../workbench/generationCanvas/nodes/director/DirectorEditor.tsx'],
  ['ComfyUI 工作流设置整页', '../../ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx'],
  ['全景查看器', '../../workbench/generationCanvas/nodes/PanoramaViewer.tsx'],
  ['素材预览', '../../workbench/assets/AssetPreviewDialog.tsx'],
] as const

describe('全屏浮层不盖住合一顶栏（它同时是窗口栏：导演台顶栏点不动那一类）', () => {
  it('顶栏高度是全屏浮层顶偏移的唯一来源', () => {
    expect(fullscreenOverlayTopOffset()).toBe(SHELL_TOPBAR_HEIGHT)
  })

  it.each(FULLSCREEN_OVERLAYS)('%s 让开窗口栏而不是 inset-0 铺满', (_name, file) => {
    const source = read(file)
    expect(source).toContain('currentFullscreenOverlayTopOffset')
    expect(source).not.toContain('fixed inset-0')
  })

  it.each(FULLSCREEN_OVERLAYS)('%s 的顶偏移在渲染时现算，不在模块作用域定死', (_name, file) => {
    // 同 #58 的第二个坑：模块常量在 import 那一刻求值，那时 window.nomiDesktop 可能还没挂上，
    // platform 读成 undefined → 悄悄回落成 0，Windows 上又贴回拖拽带。
    expect(read(file)).not.toMatch(/^const\s+[A-Z_]+\s*=\s*currentFullscreenOverlayTopOffset/m)
  })
})

it('inline whiteboard remains node content rather than a fullscreen overlay', () => {
  const source = read('../../workbench/generationCanvas/nodes/whiteboard/InlineWhiteboard.tsx')
  expect(source).toContain('data-nomi-inline-whiteboard')
  expect(source).not.toMatch(/fixed\s+inset-0/)
})

// 2026-10-28（开屏「跳过」被顶栏压住）：这一类的另一半——刻意盖住顶栏的整屏层。
//
// 上面那族是「让开顶栏」。开屏是一次性的品牌片，要整屏的样子，所以它刻意盖住顶栏（层级走刻度 applicationModal）。
// 盖住的代价同样来自几何：40px 带是系统拖拽带（Windows 右端还有原生三键），落在带里的点击被系统吃掉，
// 而 CDP / Playwright 的合成点击绕过原生命中测试，什么自动检查都会绿。所以这一类的规矩是反过来的：
//   ① 根真的在顶栏之上：层级是刻度里高于 shellChrome 的一档，手写数字不算；
//   ② 可交互内容全落在带外：根的直接子节点、绝对定位、行内 top ≥ 顶栏高（由 windowChrome 的单口给出），不许 top-N 类名。
// 「跳过」曾是 top-7（y 28–46，有 12px 在带里，中心 y=37 点下去就是拖窗口 / 最大化）。
// 判据落在渲染出来的标记上，不落在源码文字上：改回 top-7、改回 z-[60]、再加一个没定位的按钮，都会红。
// 真像素那一层（中心点系统视角、与带重叠、Windows 三键区）由 tests/ux/first-launch-system-locale.walk.mjs 量。
type MarkupElement = DefaultTreeAdapterMap['element']
type MarkupNode = DefaultTreeAdapterMap['node']

function markupElements(html: string): MarkupElement[] {
  const found: MarkupElement[] = []
  const visit = (node: MarkupNode): void => {
    if ('tagName' in node) found.push(node)
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  parseFragment(html).childNodes.forEach(visit)
  return found
}

const attrOf = (el: MarkupElement, name: string): string | undefined => el.attrs.find((attr) => attr.name === name)?.value
const classesOf = (el: MarkupElement): string[] => (attrOf(el, 'class') ?? '').split(/\s+/).filter(Boolean)

function inlinePx(el: MarkupElement, property: string): number | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`).exec(attrOf(el, 'style') ?? '')
  return match ? Number(match[1]) : null
}

/** 类名里的 `z-<档>` 取刻度里的值；手写的 `z-[60]` 之类不在刻度里，返回 null。 */
function scaleTierOf(el: MarkupElement): number | null {
  for (const cls of classesOf(el)) {
    const token = /^z-(.+)$/.exec(cls)?.[1]
    const value = token === undefined ? undefined : NOMI_OVERLAY_Z_INDEX_CSS_VARS[`--nomi-z-${token}`]
    if (value !== undefined) return Number(value)
  }
  return null
}

const NATIVE_INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])
const INTERACTIVE_ROLE = /^(?:button|link|menuitem|tab|switch|checkbox|radio|slider|textbox|combobox)$/
const isInteractive = (el: MarkupElement): boolean =>
  NATIVE_INTERACTIVE.has(el.tagName) || attrOf(el, 'tabindex') !== undefined || INTERACTIVE_ROLE.test(attrOf(el, 'role') ?? '')

/** 判一个盖住顶栏的整屏层渲染出来的标记：返回违规说明，空数组 = 通过。 */
function coveringOverlayViolations(html: string): { interactive: number; violations: string[] } {
  const all = markupElements(html)
  const root = all.find((el) => classesOf(el).includes('fixed') && classesOf(el).includes('inset-0'))
  if (!root) return { interactive: 0, violations: ['渲染里找不到 fixed inset-0 的根'] }
  const violations: string[] = []
  const tier = scaleTierOf(root)
  if (tier === null || tier <= NOMI_OVERLAY_Z_INDEX.shellChrome) {
    violations.push(`根的层级必须是刻度里高于 shellChrome(${NOMI_OVERLAY_Z_INDEX.shellChrome}) 的一档，手写数字不算：class="${attrOf(root, 'class')}"`)
  }
  const interactive = all.filter((el) => el !== root && isInteractive(el))
  for (const el of interactive) {
    const who = `<${el.tagName} class="${attrOf(el, 'class') ?? ''}">`
    const top = inlinePx(el, 'top')
    if (el.parentNode !== root) violations.push(`${who} 不是根的直接子节点，它的 top 不是相对视口的，判不了是否在带外`)
    else if (!classesOf(el).includes('absolute')) violations.push(`${who} 没有绝对定位，位置取决于流式布局，判不了是否在带外`)
    else if (top === null) violations.push(`${who} 没有行内 top：top-N 类名判不了是否在带外，顶偏移要由 windowChrome 的单口给出`)
    else if (top < fullscreenOverlayTopOffset()) violations.push(`${who} 的 top=${top}px 落在 ${fullscreenOverlayTopOffset()}px 顶栏带里：点击会被系统当成拖窗口 / 窗口按钮吃掉`)
  }
  return { interactive: interactive.length, violations }
}

// 盖住顶栏的整屏层名单。每一项都要渲染出真标记过 coveringOverlayViolations，并且至少有 minInteractive 个可交互元素
// （判据不能在一个空集合上恒真）。
const TOPBAR_COVERING_OVERLAYS = [
  {
    name: '开屏动画',
    file: 'workbench/onboarding/SplashIntro.tsx',
    minInteractive: 1,
    render: () => renderToStaticMarkup(createElement(SplashIntro, { onDone: () => undefined })),
  },
] as const

// 铺满整窗、但在另一份文档里的层：没有外壳，也就没有顶栏 / 窗口栏可盖（2026-09-04 合同判 not-affected 的那一个）。
const SEPARATE_DOCUMENT_OVERLAYS = [
  { name: '浏览器素材浮层', file: 'ui/browser/overlay/BrowserAssetOverlayApp.tsx' },
] as const

describe('盖住顶栏的整屏层：根在顶栏之上、可交互内容全在带外（开屏「跳过」点不到那一类）', () => {
  it.each(TOPBAR_COVERING_OVERLAYS)('$name 渲染出来：根走刻度，可交互元素都落在顶栏带外', ({ render, minInteractive }) => {
    const { interactive, violations } = coveringOverlayViolations(render())
    expect(violations).toEqual([])
    expect(interactive).toBeGreaterThanOrEqual(minInteractive)
  })

  it('判据自身不恒真：top-7 类名、手写 z-[60]、没定位的按钮各自被判出来，正确写法放行', () => {
    const covering = 'fixed inset-0 z-application-modal'
    const bad = (html: string): string[] => coveringOverlayViolations(html).violations
    // 「跳过」的老写法：top-7 是类名，行内没有 top。
    expect(bad(`<div class="${covering}"><button type="button" class="absolute top-7 right-9">x</button></div>`)).toHaveLength(1)
    // 行内 top 落在带里（28px = 老 top-7 的位置）。
    expect(bad(`<div class="${covering}"><button type="button" class="absolute right-9" style="top:28px">x</button></div>`)).toHaveLength(1)
    // 手写 z-[60]：低于顶栏，顶栏会画在它上面。
    expect(bad('<div class="fixed inset-0 z-[60]"><button type="button" class="absolute right-9" style="top:48px">x</button></div>')).toHaveLength(1)
    // 没定位的按钮（流式布局，位置判不了）与嵌在别的容器里的按钮（top 不是相对视口）。
    expect(bad(`<div class="${covering}"><button type="button">x</button></div>`)).toHaveLength(1)
    expect(bad(`<div class="${covering}"><div class="absolute"><button type="button" class="absolute" style="top:48px">x</button></div></div>`)).toHaveLength(1)
    // 正确写法：刻度里的档 + 根的直接子节点 + 绝对定位 + 行内 top 在带外。
    expect(bad(`<div class="${covering}"><button type="button" class="absolute right-9" style="top:${SHELL_TOPBAR_HEIGHT + 8}px">x</button></div>`)).toEqual([])
  })

  // 发现：名单不能靠自觉。铺满整窗（fixed inset-0）又不是居中遮罩的根，每一个都必须在两张名单之一，
  // 另一边是「让开顶栏」那族（FULLSCREEN_OVERLAYS，源码里不许再有 fixed inset-0）。
  // 居中遮罩（同一个 className 字符串里就带居中类）不在此列：遮罩本身没有控件，内容居中，2026-09-04 合同判 not-affected。
  // 扫的是字面量 `fixed inset-0`（与上面那族同一口径）；居中遮罩里贴边的控件、窗口很矮时卡片顶进带，静态扫描判不了，没扫。
  it('src 里每个铺满整窗的 fixed inset-0 根都已分类，没有悄悄绕过名单的', () => {
    const CENTERED_SCRIM = /\b(?:place-items-center|items-center\s+justify-center|justify-center\s+items-center)\b/
    const srcDir = fileURLToPath(new URL('../../', import.meta.url))
    const fixedInsetLiterals = (source: string): string[] =>
      source.split('\n').flatMap((line) => {
        const found: string[] = []
        for (let at = line.indexOf('fixed inset-0'); at >= 0; at = line.indexOf('fixed inset-0', at + 1)) {
          const quote = ["'", '"', '`'].find((q) => line.lastIndexOf(q, at) >= 0 && line.indexOf(q, at) > at)
          if (quote) found.push(line.slice(line.lastIndexOf(quote, at) + 1, line.indexOf(quote, at)))
        }
        return found
      })
    const fullBleedRootFiles = (readdirSync(srcDir, { recursive: true }) as string[])
      .map((file) => file.replaceAll('\\', '/'))
      // devlab 是设计实验室里的假窗口稿件，不是 App 的真全屏层。
      .filter((file) => file.endsWith('.tsx') && !/\.(?:test|spec)\./.test(file) && !file.startsWith('devlab/'))
      .filter((file) => fixedInsetLiterals(read(`../../${file}`)).some((literal) => !CENTERED_SCRIM.test(literal)))
      .sort()
    const registered = [...TOPBAR_COVERING_OVERLAYS, ...SEPARATE_DOCUMENT_OVERLAYS].map((overlay) => overlay.file).sort()
    expect(
      fullBleedRootFiles,
      '有铺满整窗的 fixed inset-0 根没分类：要么改成让开顶栏（currentFullscreenOverlayTopOffset，进 FULLSCREEN_OVERLAYS），'
        + '要么登记为盖住顶栏的整屏层（TOPBAR_COVERING_OVERLAYS，可交互内容全在带外），要么证明它在独立文档里（SEPARATE_DOCUMENT_OVERLAYS）；'
        + '名单里多出来的也说明那个文件已经不是整窗根了，该删',
    ).toEqual(registered)
  })

  it('独立文档那一类的前提：src/main.tsx 里它替掉整个 App，而不是挂在 App 里面', () => {
    expect(read('../../main.tsx')).toMatch(/browserAssetOverlay\s*\?\s*<BrowserAssetOverlayApp\s*\/>\s*:\s*<NomiRouterApp\s*\/>/)
  })
})
