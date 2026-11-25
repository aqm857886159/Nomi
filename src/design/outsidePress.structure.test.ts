import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 2026-10-23 用户实测：画布左下「⋯」浮层点开后，点画布中间不收、一直挡着；左栏抽屉、任务中心同因。
// 直接原因：「点外面就收」听的是 document / window 上冒泡的 mousedown，而画布空白处的 d3-zoom 在 mousedown 上
// stopImmediatePropagation——画布上每一次按下都到不了 document。
// 2026-11-24 第⑤刀：9 个消费者全部迁到 @floating-ui/react（useFloating + useDismiss，经 src/design/overlayLayers.ts 的
// useFloatingOutsideDismiss 收口），同提交删除手写 src/design/outsidePress.ts。
//   ① 手写 src/design/outsidePress.ts 已删除，全仓零 listenOutsidePress 残留；
//   ② src/design/overlayLayers.ts 的 useFloatingOutsideDismiss 固定走 @floating-ui/react 的 useDismiss（pointerdown + capture:true）；
//   ③ 不许在 document / window / ownerDocument 上听 mousedown / touchstart（d3 必吃），且 src/design/ 内零手写按下监听；
//   ④ 不许用 Mantine 的 useClickOutside（它听的就是 document 冒泡的 mousedown + touchstart）；
//   ⑤ document / window 上冒泡阶段的 pointerdown / click 只许减不许增（存量冻结在 BUBBLE_PRESS_BASELINE）。
// 这是普查：遍历 src 全部非测试源码与概念登记清单，对每一处按下监听与登记消费者判一次；存量例外只认下面登记的清单（BUBBLE_PRESS_BASELINE）。
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const DELETED_LEGACY_OWNER = 'src/design/outsidePress.ts'
const OWNER = 'src/design/overlayLayers.ts'
const CONCEPT_REGISTRY_FILE = 'docs/engineering/concept-owners/ui.outside-press-dismiss.json'
const registeredConsumers = (
  JSON.parse(readFileSync(resolve(process.cwd(), CONCEPT_REGISTRY_FILE), 'utf8')) as { allowed_consumers: string[] }
).allowed_consumers
const BUBBLE_PRESS_BASELINE: Record<string, number> = {
  'src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowMenus.ts': 1,
  'src/workbench/generationCanvas/nodes/whiteboard/useWhiteboardSelectionActions.ts': 1,
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(full) && !/\.test\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

const sources = walk(resolve(process.cwd(), 'src')).map((file) => ({
  file: relative(process.cwd(), file).split('\\').join('/'),
  code: stripComments(readFileSync(file, 'utf8')),
}))

type PressListener = { file: string, event: string, capture: boolean }
const PRESS_EVENTS = 'mousedown|touchstart|pointerdown|click'
const ADD_LISTENER = new RegExp(`\\b(?:document|window|ownerDocument)\\s*\\??\\.addEventListener\\(\\s*['"](${PRESS_EVENTS})['"]`, 'g')
const WINDOW_EVENT_HOOK = new RegExp(`\\buseWindowEvent\\(\\s*['"](${PRESS_EVENTS})['"]`, 'g')

/** 从 `(` 起数括号，取整个调用的参数文本（处理器写成内联函数时，捕获参数在函数体后面）。 */
function callArguments(code: string, openParen: number): string {
  let depth = 0
  for (let index = openParen; index < code.length; index += 1) {
    const char = code[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return code.slice(openParen + 1, index)
    }
  }
  return code.slice(openParen + 1)
}

/** 最后一个顶层参数（捕获参数：`true` 或 `{ capture: true }`）。多行调用的尾逗号先去掉，否则最后一段是空串。 */
function lastTopLevelArgument(rawArgs: string): string {
  const args = rawArgs.replace(/,\s*$/, '')
  let depth = 0
  let start = 0
  for (let index = 0; index < args.length; index += 1) {
    const char = args[index]
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    else if (char === ',' && depth === 0) start = index + 1
  }
  return args.slice(start).trim()
}

function pressListeners(file: string, code: string): PressListener[] {
  const found: PressListener[] = []
  for (const match of code.matchAll(ADD_LISTENER)) {
    const openParen = (match.index ?? 0) + match[0].indexOf('(')
    const args = callArguments(code, openParen)
    const last = lastTopLevelArgument(args)
    found.push({ file, event: match[1], capture: /^true$|capture\s*:\s*true/.test(last) })
  }
  // useWindowEvent 只能挂冒泡阶段。
  for (const match of code.matchAll(WINDOW_EVENT_HOOK)) found.push({ file, event: match[1], capture: false })
  return found
}

const listeners = sources.flatMap(({ file, code }) => pressListeners(file, code))

describe('「点外面就收」只有一种听法', () => {
  it('识别器认得出各种写法（反例自检）', () => {
    const probe = [
      "document.addEventListener('mousedown', (event) => { if (x) close() })",
      "window.addEventListener('click', function close() { setOpen(false) })",
      "node.ownerDocument.addEventListener('touchstart', handler)",
      "useWindowEvent('mousedown', () => close())",
      "document.addEventListener('pointerdown', (event) => { close(event) }, { capture: true })",
      "document.addEventListener('pointerdown', onDown)",
      "document.addEventListener(\n  'pointerdown',\n  onDown,\n  { capture: true },\n)",
    ].join('\n')
    expect(pressListeners('probe', probe).map(({ event, capture }) => `${event}:${capture}`)).toEqual([
      'mousedown:false', 'click:false', 'touchstart:false', 'pointerdown:true', 'pointerdown:false', 'pointerdown:true', 'mousedown:false',
    ])
  })

  it('手写 outsidePress.ts 已删除且全仓无 listenOutsidePress 残留', () => {
    expect(existsSync(resolve(process.cwd(), DELETED_LEGACY_OWNER))).toBe(false)
    expect(sources.filter(({ code }) => /\blistenOutsidePress\b/.test(code)).map(({ file }) => file)).toEqual([])
    expect(listeners.filter(({ file }) => file.startsWith('src/design/'))).toEqual([])
  })

  it('document / window 上没有 mousedown / touchstart 监听', () => {
    expect(listeners.filter(({ event }) => event === 'mousedown' || event === 'touchstart').map(({ file, event }) => `${file} ${event}`)).toEqual([])
  })

  it('不用 Mantine 的 useClickOutside', () => {
    expect(sources.filter(({ code }) => /import[^;]*\buseClickOutside\b[^;]*from\s*['"]@mantine\/hooks['"]/.test(code)).map(({ file }) => file)).toEqual([])
  })

  it('冒泡阶段的 pointerdown / click 只许减不许增', () => {
    const counts: Record<string, number> = {}
    for (const { file, event, capture } of listeners) {
      if ((event !== 'pointerdown' && event !== 'click') || capture) continue
      counts[file] = (counts[file] ?? 0) + 1
    }
    for (const [file, count] of Object.entries(counts)) expect({ file, count }).toEqual({ file, count: Math.min(count, BUBBLE_PRESS_BASELINE[file] ?? 0) })
  })

  it('owner 经 @floating-ui/react 的 useDismiss 在捕获阶段听 pointerdown', () => {
    const ownerCode = sources.find(({ file }) => file === OWNER)?.code ?? ''
    expect(ownerCode).toMatch(/import\s*\{[^}]*\buseDismiss\b[^}]*\buseFloating\b[^}]*\}\s*from\s*['"]@floating-ui\/react['"]/)
    expect(ownerCode).toMatch(/outsidePressEvent:\s*['"]pointerdown['"]/)
    expect(ownerCode).toMatch(/capture:\s*\{\s*outsidePress:\s*true\s*\}/)
  })

  it.each(registeredConsumers)('登记消费者 %s 走 useFloatingOutsideDismiss', (consumerFile) => {
    const code = sources.find(({ file }) => file === consumerFile)?.code ?? ''
    expect(code).toMatch(/\buseFloatingOutsideDismiss\b/)
  })
})

// 关掉之后还不还焦点只归 AnchoredPopover：因点外面关闭不还，Esc / 选一项关闭还给打开前的元素。
// 调用方在自己的关闭里把焦点塞回锚点就绕过了它：点在不抢焦点的东西上（mousedown 里 preventDefault 的按钮、禁用钮）时，
// 焦点停回触发钮、悬停提示挂着（独立验收 L-acc-opus-20261023 建议 2；NodeEffectChips、CanvasControlsHelpPopover 两处已删）。
// 普查：渲染 <AnchoredPopover anchorRef={x}> 的文件里，不许出现 x.current…focus(。
function anchorRefocusCalls(code: string): string[] {
  if (!code.includes('<AnchoredPopover')) return []
  const anchors = [...code.matchAll(/anchorRef=\{(\w+)\}/g)].map((match) => match[1])
  return anchors.flatMap((name) => [...code.matchAll(new RegExp(`\\b${name}\\.current\\??\\.(?:[\\w$]+\\([^)]*\\)\\??\\.)*focus\\(`, 'g'))].map((match) => match[0]))
}

describe('关掉之后还不还焦点只归 AnchoredPopover', () => {
  it('识别器认得出「关闭时把焦点塞回锚点」（反例自检）', () => {
    const probe = [
      'const close = () => { setOpen(false); anchorRef.current?.focus() }',
      "const close = React.useCallback(() => { setOpen(false); triggerRef.current?.querySelector('button')?.focus() }, [])",
      '<AnchoredPopover anchorRef={anchorRef} onClose={close} />',
      '<AnchoredPopover anchorRef={triggerRef} onClose={close} />',
    ].join('\n')
    expect(anchorRefocusCalls(probe)).toEqual(['anchorRef.current?.focus(', "triggerRef.current?.querySelector('button')?.focus("])
  })

  it('渲染 AnchoredPopover 的文件不自己把焦点塞回锚点', () => {
    expect(sources.flatMap(({ file, code }) => anchorRefocusCalls(code).map((call) => `${file} ${call}`))).toEqual([])
  })
})
