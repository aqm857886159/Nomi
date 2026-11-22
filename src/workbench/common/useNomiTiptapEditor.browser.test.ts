import { createRequire } from 'node:module'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * 编辑器唯一入口（useNomiTiptapEditor）：每个实例出生时文档就是 owner 此刻的值（2026-11-21，#1573 换方向）。
 * 入口只认 owner（subscribe / getSnapshot / write），出生时自己调 getSnapshot()，不收渲染时的值。
 *
 * 真 React 19 + 真 TipTap（不用 vi.mock 替身），在 chromium 里挂上去，三种建实例的路都走：
 *   · 首次挂载；
 *   · deps 变化（入口销毁旧实例、造新实例）；
 *   · React `<Activity>` 藏起 → 藏起期间 store 变了 → 放出（分镜页就是这样：WorkbenchShell 的分镜槽 freezeWhenHidden，
 *     藏起时 effect 全卸，TipTap 销毁实例；放出时重造）。编辑器在 memo 后面时，放出那一刻渲染拿不到新值——
 *     这一条在旧设计（入口收渲染时的值）下字对了但进了撤销历史，换成 owner 以后必须三件都对。
 * 每条都核三件事：文档 = 当前真值；这次填入不回写（write 0 次）；不进撤销历史（can().undo() 假）。
 * 还走分镜提示词框（PromptEditor）的原始现场：'' → 'A' → 藏 → 放，框里是 'A'（修前只剩占位字）。
 *
 * 结果经 window 回到 Node 用 expect 断言；场景里抛的错也一并带回，修前是断言红，不是加载红。
 */

const HARNESS = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useNomiTiptapEditor, useNomiRichTextEditor } from './src/workbench/common/useNomiRichTextEditor'
import PromptEditor from './src/workbench/assets/PromptEditor'

window.pageErrors = []
window.addEventListener('error', (event) => window.pageErrors.push(String(event.message)))
window.addEventListener('unhandledrejection', (event) => window.pageErrors.push(String(event.reason)))

const EXTENSIONS = [StarterKit]
const textToDoc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] })
const docToText = (doc) => (doc.content || []).map((block) => (block.content || []).map((leaf) => leaf.text || '').join('')).join('\\n')
const TEXT_CODEC = { toDoc: textToDoc, fromDoc: docToText, keyOf: (text) => text }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = () => sleep(60)

/** 一个外部 store（照 zustand：subscribe / getState / setState）。 */
function makeStore(initial) {
  let value = initial
  const listeners = new Set()
  return {
    get: () => value,
    set: (next) => { value = next; for (const listener of listeners) listener() },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
}

/** 宿主交给编辑器的 owner：读口就是 store，写口记一笔再写回 store（和生产宿主一样）。 */
function ownerOf(store, rig) {
  return { subscribe: store.subscribe, getSnapshot: store.get, write: (next) => { rig.changes.push(next); store.set(next) } }
}

function PlainEditor({ rig, owner, rebuildKey }) {
  const editor = useNomiTiptapEditor({ owner, codec: TEXT_CODEC, extensions: EXTENSIONS }, [rebuildKey])
  rig.editor = editor
  return React.createElement(EditorContent, { editor })
}

function DocEditor({ rig, owner }) {
  const { editor } = useNomiRichTextEditor({ owner })
  rig.editor = editor
  return React.createElement(EditorContent, { editor })
}

function PromptBox({ rig, owner }) {
  return React.createElement(PromptEditor, { owner, placeholder: 'placeholder', onReady: (editor) => { rig.editor = editor } })
}

/** 分镜行 / 画布节点的真实形状：编辑器在一层 memo 后面，放出那一刻 memo 挡住重渲染，渲染拿不到藏起期间的新值。 */
const MEMOIZED = new Map()
function memoOf(Editor) {
  if (!MEMOIZED.has(Editor)) MEMOIZED.set(Editor, React.memo(Editor))
  return MEMOIZED.get(Editor)
}

function Host({ rig, owner, Editor, memoBoundary }) {
  const [visible, setVisible] = React.useState(true)
  const [rebuildKey, setRebuildKey] = React.useState(0)
  rig.setters = { setVisible, setRebuildKey }
  const Child = memoBoundary ? memoOf(Editor) : Editor
  return React.createElement(React.Activity, { mode: visible ? 'visible' : 'hidden' }, React.createElement(Child, { rig, owner, rebuildKey }))
}

async function mount({ initial, Editor, memoBoundary = false }) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const root = createRoot(element)
  const rig = { editor: null, changes: [], setters: {} }
  const store = makeStore(initial)
  const owner = ownerOf(store, rig)
  flushSync(() => root.render(React.createElement(Host, { rig, owner, Editor, memoBoundary })))
  await settle()
  return { rig, store }
}

function read(rig, extra = {}) {
  const editor = rig.editor
  const alive = Boolean(editor && !editor.isDestroyed)
  return {
    alive,
    text: alive ? editor.getText({ blockSeparator: '\\n' }) : null,
    changes: rig.changes.length,
    canUndo: alive ? editor.can().undo() : null,
    ...extra,
  }
}

async function act(fn) { flushSync(fn); await settle() }

/** 藏起 → 藏起期间 store 变成 next → 放出；回答这次是不是换了实例。 */
async function hideChangeReveal(rig, store, next) {
  const first = rig.editor
  await act(() => rig.setters.setVisible(false))
  await act(() => store.set(next))
  await act(() => rig.setters.setVisible(true))
  return rig.editor !== first
}

const scenarios = {
  /** 首次挂载：出生就是 owner 的值。 */
  async firstMount() {
    const { rig } = await mount({ initial: 'TRUE VALUE', Editor: PlainEditor })
    return read(rig)
  },
  /** deps 变化，同一次提交里 store 也变了：新实例出生就是新值。 */
  async depsRebuild() {
    const { rig, store } = await mount({ initial: 'A', Editor: PlainEditor })
    const first = rig.editor
    await act(() => { store.set('B'); rig.setters.setRebuildKey(1) })
    return read(rig, { rebuilt: rig.editor !== first })
  },
  /** <Activity> 藏起期间 store 变了，放出后重建：文档 = store 的值。 */
  async activityStoreChanged() {
    const { rig, store } = await mount({ initial: 'A', Editor: PlainEditor })
    return read(rig, { rebuilt: await hideChangeReveal(rig, store, 'B') })
  },
  /** 同上，编辑器在 memo 后面：放出那一刻渲染拿不到新值，只有出生时读 owner 才对。 */
  async activityStoreBehindMemo() {
    const { rig, store } = await mount({ initial: 'A', Editor: PlainEditor, memoBoundary: true })
    return read(rig, { rebuilt: await hideChangeReveal(rig, store, 'B') })
  },
  /** 创作者敲了字（经 owner 写回 store）→ 藏 → 放：框里是刚敲的字，放出不再回写。 */
  async activityAfterTyping() {
    const { rig, store } = await mount({ initial: 'A', Editor: PlainEditor })
    rig.editor.commands.focus('end')
    rig.editor.commands.insertContent('X')
    await settle()
    const typed = store.get()
    const changesBefore = rig.changes.length
    const first = rig.editor
    await act(() => rig.setters.setVisible(false))
    await act(() => rig.setters.setVisible(true))
    const result = read(rig, { rebuilt: rig.editor !== first, typed })
    return { ...result, changes: result.changes - changesBefore }
  },
  /** 文稿内核（创作文档 / 画布文字节点）：藏起期间文稿变了，放出后文档 = 新文稿。 */
  async richTextActivity() {
    const { rig, store } = await mount({ initial: textToDoc('Doc A'), Editor: DocEditor })
    return read(rig, { rebuilt: await hideChangeReveal(rig, store, textToDoc('Doc B')) })
  },
  /** 同上，文稿编辑器在 memo 后面（画布节点就是 memo 的）。 */
  async richTextBehindMemo() {
    const { rig, store } = await mount({ initial: textToDoc('Doc A'), Editor: DocEditor, memoBoundary: true })
    return read(rig, { rebuilt: await hideChangeReveal(rig, store, textToDoc('Doc B')) })
  },
  /** 文稿 owner 存的是非 TipTap 规范写法（键序不同、空段落不带 content）：出生后既不改文档也不回写。 */
  async richTextNonCanonical() {
    const value = { content: [{ type: 'paragraph', content: [{ text: 'Doc', type: 'text' }] }, { type: 'paragraph' }], type: 'doc' }
    const { rig } = await mount({ initial: value, Editor: DocEditor })
    return read(rig)
  },
  /** 分镜提示词框的原始现场：store '' → 'A'（框开着时的外部写入）→ 藏 → 放，框里是 'A'。 */
  async promptEditorActivity() {
    const { rig, store } = await mount({ initial: '', Editor: PromptBox })
    await act(() => store.set('A'))
    const afterWrite = read(rig).text
    const first = rig.editor
    await act(() => rig.setters.setVisible(false))
    await act(() => rig.setters.setVisible(true))
    return read(rig, { rebuilt: rig.editor !== first, afterWrite })
  },
  /** 分镜行的形状：提示词框在 memo 后面，藏起期间这一镜的提示词被改成 'A'，放出后框里是 'A'。 */
  async promptEditorBehindMemo() {
    const { rig, store } = await mount({ initial: '', Editor: PromptBox, memoBoundary: true })
    return read(rig, { rebuilt: await hideChangeReveal(rig, store, 'A') })
  },
}

/** 场景里抛的错（修前入口不认 owner 时会抛）也带回 Node，由断言判红，不让整份文件加载不起来。 */
window.runScenario = async (name) => {
  try {
    return await scenarios[name]()
  } catch (error) {
    return { alive: false, text: null, changes: -1, canUndo: null, error: String((error && error.stack) || error) }
  }
}
window.harnessReady = true
`

type ScenarioResult = {
  alive: boolean
  text: string | null
  changes: number
  canUndo: boolean | null
  rebuilt?: boolean
  typed?: string
  afterWrite?: string | null
  error?: string
}

let browser: Browser
let page: Page
const results = new Map<string, ScenarioResult>()

async function run(name: string): Promise<ScenarioResult> {
  const cached = results.get(name)
  if (cached) return cached
  const result = (await page.evaluate(`window.runScenario(${JSON.stringify(name)})`)) as ScenarioResult
  results.set(name, result)
  return result
}

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const bundle = await build({
    stdin: { contents: HARNESS, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty' },
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  browser = await chromium.launch()
  page = await browser.newPage()
  page.setDefaultTimeout(5000)
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.waitForFunction('window.harnessReady === true')
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

/** 每个建实例的路：出生 / 重建以后都要「文档 = 真值、不回写、不进撤销历史」。 */
const BIRTHS = [
  'firstMount',
  'depsRebuild',
  'activityStoreChanged',
  'activityStoreBehindMemo',
  'activityAfterTyping',
  'richTextActivity',
  'richTextBehindMemo',
  'richTextNonCanonical',
  'promptEditorActivity',
  'promptEditorBehindMemo',
]

describe('useNomiTiptapEditor：每个实例出生时文档就是 owner 此刻的值', () => {
  it('首次挂载：文档 = owner 的值', async () => {
    expect((await run('firstMount')).text).toBe('TRUE VALUE')
  })

  it('重建后再填：deps 重建 / Activity 藏起期间 store 变了（含 memo 后面）/ 敲过字再藏放 / 文稿内核 / 分镜提示词框，文档都 = 当前真值', async () => {
    const expected: Record<string, string> = {
      depsRebuild: 'B',
      activityStoreChanged: 'B',
      activityStoreBehindMemo: 'B',
      activityAfterTyping: 'AX',
      richTextActivity: 'Doc B',
      richTextBehindMemo: 'Doc B',
      promptEditorActivity: 'A',
      promptEditorBehindMemo: 'A',
    }
    for (const [name, text] of Object.entries(expected)) {
      const result = await run(name)
      expect({ name, rebuilt: result.rebuilt, text: result.text, error: result.error }).toEqual({ name, rebuilt: true, text, error: undefined })
    }
    expect((await run('activityAfterTyping')).typed).toBe('AX')
  })

  it('框开着时 owner 被外部改了：框跟上新值', async () => {
    expect((await run('promptEditorActivity')).afterWrite).toBe('A')
  })

  it('再填不回写：出生 / 重建 / 外部写入后 write 0 次（非规范写法的文稿也不回写）', async () => {
    for (const name of BIRTHS) {
      expect({ name, changes: (await run(name)).changes }).toEqual({ name, changes: 0 })
    }
  })

  it('再填不进撤销历史：出生 / 重建后 can().undo() 为假（编辑器在 memo 后面也一样）', async () => {
    for (const name of BIRTHS) {
      expect({ name, canUndo: (await run(name)).canUndo }).toEqual({ name, canUndo: false })
    }
  })

  it('页面没有报错', async () => {
    for (const name of BIRTHS) await run(name)
    expect(await page.evaluate('window.pageErrors')).toEqual([])
  })
})
