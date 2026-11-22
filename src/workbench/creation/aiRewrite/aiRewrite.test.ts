import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import i18n from '../../../i18n'
import { VendorRequestError, encodeVendorErrorMessage } from '../../../../electron/vendor/vendorHttp'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { createRewriteController, type RewriteController, type RewriteHost } from './rewriteController'
import * as rewriteSessionModule from './rewriteSession'
import { buildRewriteDecorations, createRewritePlugin, getRewriteSession, openRewriteTransaction, rangeText, rewriteSessionKey, rewriteDocumentIdentity, setRewriteDocumentIdentityTransaction, type RewriteRequirement } from './rewriteSession'
import { REWRITE_PRESET_INSTRUCTIONS, buildRewritePrompt, cleanRewriteOutput, isWritingSkill, skillBodyText } from './rewritePrompt'
import { diffRewrite } from './rewriteDiff'
import type { SkillListItemDto } from '../../api/skillApi'

// —— 真 schema + 真插件 + 真撤销栈（没有 DOM：宿主只是一份 EditorState）——————————————————
const schema = getSchema([StarterKit])

const doc = (...paragraphs: string[]): ProseMirrorNode =>
  ProseMirrorNode.fromJSON(schema, {
    type: 'doc',
    content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  })

type TestHost = RewriteHost & {
  select(from: number, to: number): void
  edit(from: number, to: number, text: string): void
  /** 在当前光标/选区处敲字（同编辑器真实打字：同时置 docChanged 与 selectionSet）。 */
  type(text: string): void
  undo(): void
  /** 切文稿：和 WorkbenchEditor 的布局副作用一样，发一笔只改「当前是哪篇文稿」的事务（正文可以一模一样、编辑器照旧复用）。 */
  switchDocument(id: string): void
  text(): string
  /** 等到某个条件在状态里成立（靠事务通知，不靠墙钟）。 */
  until(predicate: () => boolean): Promise<void>
}

function createHost(initial: ProseMirrorNode): TestHost {
  let state = EditorState.create({ doc: initial, plugins: [history(), createRewritePlugin()] })
  const listeners = new Set<() => void>()
  const host: TestHost = {
    get state() { return state },
    dispatch(transaction: Transaction) {
      state = state.apply(transaction)
      Array.from(listeners).forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    select(from, to) { host.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to))) },
    edit(from, to, text) { host.dispatch(state.tr.insertText(text, from, to)) },
    type(text) { host.dispatch(state.tr.insertText(text)) },
    undo() { undo(state, (transaction) => host.dispatch(transaction)) },
    switchDocument(id) { host.dispatch(setRewriteDocumentIdentityTransaction(state, id)) },
    text() { return state.doc.textBetween(0, state.doc.content.size, '\n') },
    until(predicate) {
      if (predicate()) return Promise.resolve()
      return new Promise((resolve) => {
        const off = host.subscribe(() => { if (predicate()) { off(); resolve() } })
      })
    },
  }
  return host
}

// —— 假模型：替换的是桌面桥（模型那一头），渲染层的 getTextBrain / 流式任务 / 项目签发全是真代码 ————
type FakeRequest = { prompt: string; signalAborted: () => boolean; reply(text: string): void; fail(message: string): void }

function installFakeDesktop(options: { brain?: { vendor: string; modelKey: string } | null } = {}) {
  const requests: FakeRequest[] = []
  const cancelled: string[] = []
  const listeners = new Map<string, (event: unknown) => void>()
  let waiting: { count: number; resolve: () => void } | null = null
  const desktop = {
    promptLibrary: {
      textBrain: async () => ({ ok: true, brain: options.brain === undefined ? { vendor: 'fake-vendor', modelKey: 'fake-model' } : options.brain }),
    },
    tasks: {
      runTextStream: async (payload: { streamId: string; request: { prompt: string } }) => {
        const emit = (event: unknown) => listeners.get(payload.streamId)?.(event)
        requests.push({
          prompt: payload.request.prompt,
          signalAborted: () => cancelled.includes(payload.streamId),
          reply: (text) => { emit({ type: 'delta', delta: text }); emit({ type: 'done', result: { id: 't', status: 'succeeded' } }) },
          fail: (message) => emit({ type: 'error', message }),
        })
        if (waiting && requests.length >= waiting.count) waiting.resolve()
        return { streamId: payload.streamId }
      },
      onTextEvent: (streamId: string, listener: (event: unknown) => void) => {
        listeners.set(streamId, listener)
        return () => { listeners.delete(streamId) }
      },
      cancelTextStream: async (streamId: string) => { cancelled.push(streamId); return { ok: true } },
    },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { nomiDesktop: desktop } })
  return {
    requests,
    cancelled,
    /** 等第 n 条模型请求真的发出去。 */
    request(n: number): Promise<FakeRequest> {
      if (requests.length >= n) return Promise.resolve(requests[n - 1]!)
      return new Promise((resolve) => { waiting = { count: n, resolve: () => resolve(requests[n - 1]!) } })
    },
  }
}

/** 让已经放行的异步链（模型回包 → 控制器收尾）跑完：纯微任务，不是墙钟等待。 */
async function settle(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve()
}

const REQUIREMENT: RewriteRequirement = { text: '缩短', instruction: REWRITE_PRESET_INSTRUCTIONS.shorter, skill: null }
// 文档：段 1 = 位置 1..；每段 = 文字长度 + 2。
const P1 = '林薇回到家，没开大灯。'
const P2 = '她盯着纸条看了很久，才慢慢展开。'
const P3 = '纸上的字被潮气洇开。'
const P2_FROM = P1.length + 3
const P2_TO = P2_FROM + P2.length

let projectSession: ProjectSessionTestHarness
let controller: RewriteController
let host: TestHost
let fake: ReturnType<typeof installFakeDesktop>
let discarded: string[]

beforeEach(async () => {
  projectSession = createProjectSessionTestHarness()
  await projectSession.open('rewrite-project')
  fake = installFakeDesktop()
  host = createHost(doc(P1, P2, P3))
  host.switchDocument('doc-A')
  discarded = []
  controller = createRewriteController(host, { onDiscarded: (reason) => discarded.push(reason) })
})

afterEach(() => {
  controller.dispose()
  projectSession.dispose()
  Reflect.deleteProperty(globalThis, 'window')
})

function openOnSecondParagraph(): void {
  host.select(P2_FROM, P2_TO)
  expect(controller.open()).toBe(true)
}

async function runToResult(text = '慢慢展开纸条。'): Promise<void> {
  openOnSecondParagraph()
  controller.submit(REQUIREMENT)
  const request = await fake.request(fake.requests.length + 1)
  request.reply(text)
  await host.until(() => getRewriteSession(host.state)?.status === 'result')
}

describe('选中文字 → AI 编辑：就地出结果', () => {
  it('接受后：区间换成新文字，前后段落一个字不动；会话关闭', async () => {
    await runToResult()
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
    controller.accept()
    expect(host.text()).toBe([P1, '慢慢展开纸条。', P3].join('\n'))
    expect(getRewriteSession(host.state)).toBeNull()
  })

  it('结果出来之前文档一个字没动（结果只是叠在原文上的画）', async () => {
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    await fake.request(1)
    expect(getRewriteSession(host.state)?.status).toBe('running')
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
  })

  it('放弃后：原文不变，会话关闭', async () => {
    await runToResult()
    const before = host.state.doc.toJSON()
    controller.discard()
    expect(host.state.doc.toJSON()).toEqual(before)
    expect(getRewriteSession(host.state)).toBeNull()
  })

  it('撤销：接受是撤销栈里的一条，Ctrl+Z 回到改写前', async () => {
    await runToResult()
    const before = host.state.doc.toJSON()
    controller.accept()
    expect(host.state.doc.toJSON()).not.toEqual(before)
    host.undo()
    expect(host.state.doc.toJSON()).toEqual(before)
  })

  it('多段选区：接受后换成新的几段，周围不动', async () => {
    host.select(1, host.state.doc.content.size - 1)
    controller.open()
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    request.reply('第一句。\n第二句。')
    await host.until(() => getRewriteSession(host.state)?.status === 'result')
    controller.accept()
    expect(host.text()).toBe('第一句。\n第二句。')
    host.undo()
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
  })

  it('追加要求和 ↻ 用的是同一段原文（不是上一版结果）', async () => {
    await runToResult('慢慢展开纸条。')
    const first = fake.requests[0]!.prompt
    expect(first).toContain(P2)

    // 追加要求：改了输入框里的字再回车
    controller.submit({ text: '缩短，再冷一点', instruction: '缩短，再冷一点', skill: null })
    const appended = await fake.request(2)
    expect(appended.prompt).toContain(P2)
    expect(appended.prompt).not.toContain('慢慢展开纸条。')
    appended.reply('她慢慢展开。')
    await host.until(() => getRewriteSession(host.state)?.result === '她慢慢展开。')

    // ↻：用会话里记着的要求（上一次那条）重来
    controller.retry()
    const retried = await fake.request(3)
    expect(retried.prompt).toContain(P2)
    expect(retried.prompt).not.toContain('她慢慢展开。')
    expect(retried.prompt).toContain('缩短，再冷一点')
    expect(getRewriteSession(host.state)?.original).toBe(P2)
  })

  it('改写进行中点去第一段并打字：会话继续跑、不取消请求，区间跟着平移，结果落回第二段且保留第一段新写的字', async () => {
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)

    // 创作者趁等待时间点去第一段开头打字，再去第三段末尾补字（每次都真实改光标 + 敲字）
    host.select(1, 1)
    expect(getRewriteSession(host.state)?.status).toBe('running')
    expect(request.signalAborted()).toBe(false)

    const prefix = '【前插】'
    host.type(prefix)
    const shifted = getRewriteSession(host.state)
    expect(shifted?.status).toBe('running')
    expect(request.signalAborted()).toBe(false)
    expect(shifted?.from).toBe(P2_FROM + prefix.length)
    expect(shifted?.to).toBe(P2_TO + prefix.length)
    expect(rangeText(host.state.doc, shifted!.from, shifted!.to)).toBe(P2)

    const endOfDoc = host.state.doc.content.size - 1
    host.select(endOfDoc, endOfDoc)
    host.type('【后补】')
    expect(getRewriteSession(host.state)?.status).toBe('running')
    expect(request.signalAborted()).toBe(false)

    // 模型结果回来：就地落在平移后的第二段上，接受（✓）只换第二段，第一段和第三段刚写的字都在
    request.reply('慢慢展开纸条。')
    await host.until(() => getRewriteSession(host.state)?.status === 'result')
    expect(host.text()).toBe([`${prefix}${P1}`, P2, `${P3}【后补】`].join('\n'))
    controller.accept()
    expect(host.text()).toBe([`${prefix}${P1}`, '慢慢展开纸条。', `${P3}【后补】`].join('\n'))
    expect(getRewriteSession(host.state)).toBeNull()

    // Ctrl+Z 只撤回接受改写这一步，等待期间在第一段、第三段打的字完好保留
    host.undo()
    expect(host.text()).toBe([`${prefix}${P1}`, P2, `${P3}【后补】`].join('\n'))
  })

  it('改写进行中关掉（Esc / ✕）：同样取消，结果回来无处可写', async () => {
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    controller.discard()
    expect(request.signalAborted()).toBe(true)
    request.reply('不该出现的结果')
    await settle()
    expect(getRewriteSession(host.state)).toBeNull()
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
  })

  it('改写进行中原文被改了：会话作废并取消请求，不去覆盖用户刚写的字（结果态改原文同样作废）', async () => {
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    host.select(P2_FROM + 1, P2_FROM + 3)
    host.type('凝视')
    expect(getRewriteSession(host.state)).toBeNull()
    expect(request.signalAborted()).toBe(true)
    request.reply('慢慢展开纸条。')
    await settle()
    expect(host.text()).toContain('凝视')
    expect(host.text()).not.toContain('慢慢展开纸条。')

    // 结果已出后若用户直接手改第二段原文，旧结果装饰同样当场作废
    host.select(P2_FROM, P2_TO)
    expect(controller.open()).toBe(true)
    controller.submit(REQUIREMENT)
    const second = await fake.request(2)
    second.reply('慢慢展开纸条。')
    await host.until(() => getRewriteSession(host.state)?.status === 'result')
    host.select(P2_FROM, P2_FROM + 1)
    host.type('林薇')
    expect(getRewriteSession(host.state)).toBeNull()
    expect(host.text()).toContain('林薇凝视')
  })

  it('改写进行中前面的段落被编辑：区间跟着平移，结果仍落在原来那段字上', async () => {
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    host.edit(1, 1, '【前插】')
    request.reply('慢慢展开纸条。')
    await host.until(() => getRewriteSession(host.state)?.status === 'result')
    controller.accept()
    expect(host.text()).toBe([`【前插】${P1}`, '慢慢展开纸条。', P3].join('\n'))
  })

  it('结果已出时点了别处：结果留着（不因一次误点丢掉）；菜单态与失败态点别处则关闭', async () => {
    await runToResult()
    host.select(1, 3)
    expect(getRewriteSession(host.state)?.status).toBe('result')
    controller.discard()

    // 菜单态（尚未提交）：点去别处关闭菜单
    host.select(P2_FROM, P2_TO)
    controller.open()
    expect(getRewriteSession(host.state)?.status).toBe('menu')
    host.select(1, 3)
    expect(getRewriteSession(host.state)).toBeNull()

    // 失败态：点去别处收起报错条
    host.select(P2_FROM, P2_TO)
    controller.open()
    controller.submit(REQUIREMENT)
    const failedReq = await fake.request(2)
    failedReq.fail('temporary error')
    await host.until(() => getRewriteSession(host.state)?.status === 'failed')
    host.select(1, 3)
    expect(getRewriteSession(host.state)).toBeNull()
  })

  it('失败：原文不变，状态是「没改成」并带原因', async () => {
    openOnSecondParagraph()
    const before = host.state.doc.toJSON()
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    request.fail('Test network blocked: models.example.com')
    await host.until(() => getRewriteSession(host.state)?.status === 'failed')
    const session = getRewriteSession(host.state)!
    expect(session.failure).toContain('Test network blocked')
    expect(session.result).toBeNull()
    expect(host.state.doc.toJSON()).toEqual(before)
    // 界面上这句话：中文「没改成：原因」，英文 Could not edit: reason
    const translate = (language: string) => i18n.getFixedT(language) as unknown as (key: string, options?: object) => string
    const zh = translate('zh-CN')('creationAi.rewrite.failed', { reason: session.failure })
    expect(zh).toBe(`没改成：${session.failure}`)
    expect(translate('en')('creationAi.rewrite.failed', { reason: 'x' })).toBe('Could not edit: x')
    // ↻ 之后仍从同一段原文出发
    controller.retry()
    const retry = await fake.request(2)
    expect(retry.prompt).toContain(P2)
  })

  it('主进程的错误带结构化标记（base64）：界面上只给人话，不把乱码摆给用户', async () => {
    const marked = encodeVendorErrorMessage(new VendorRequestError('（HTTP 429）Too many requests, slow down', {
      vendorKey: 'relay', method: 'POST', url: 'https://relay.example.test/v1/chat/completions', httpStatus: 429,
      upstreamMsg: 'Too many requests, slow down', category: 'quota', retryable: true,
    }))
    expect(marked).toContain('NOMI_VENDOR_ERR_B64::')
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    request.fail(marked)
    await host.until(() => getRewriteSession(host.state)?.status === 'failed')
    const failure = getRewriteSession(host.state)!.failure!
    expect(failure).not.toContain('NOMI_VENDOR_ERR_B64')
    expect(failure).toBe('（HTTP 429）Too many requests, slow down')
  })

  it('没有可用文本模型：不发请求，写清原因，原文不变', async () => {
    fake = installFakeDesktop({ brain: null })
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    await host.until(() => getRewriteSession(host.state)?.status === 'failed')
    expect(getRewriteSession(host.state)?.failure).toBe(i18n.t('creationAi.rewrite.noTextModel'))
    expect(fake.requests).toHaveLength(0)
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
  })

  it('没有打开的项目：不发请求，写清原因', async () => {
    projectSession.close()
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    await host.until(() => getRewriteSession(host.state)?.status === 'failed')
    expect(getRewriteSession(host.state)?.failure).toBe(i18n.t('creationAi.rewrite.noProject'))
    expect(fake.requests).toHaveLength(0)
  })

  it('模型返回和原文一样：算没改成，不假装有改动', async () => {
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    request.reply(`“${P2}”`)
    await host.until(() => getRewriteSession(host.state)?.status === 'failed')
    expect(getRewriteSession(host.state)?.failure).toBe(i18n.t('creationAi.rewrite.unchanged'))
  })

  it('进行中再点一次提交不会并发第二个请求', async () => {
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    controller.submit(REQUIREMENT)
    controller.retry()
    await fake.request(1)
    await settle()
    expect(fake.requests).toHaveLength(1)
  })

  it('没选字不开；只选了空白不开', () => {
    host.select(3, 3)
    expect(controller.open()).toBe(false)
    expect(getRewriteSession(host.state)).toBeNull()
  })
})

describe('就地显示：删掉的划线、新加的标出来、段尾两个小图标', () => {
  it('结果态：旧字被划线装饰覆盖，新字是小部件，✓ ✕ 跟在段尾', async () => {
    await runToResult('她慢慢展开纸条。')
    const session = getRewriteSession(host.state)!
    const found = buildRewriteDecorations(host.state.doc, session).find()
    const inline = found.filter((decoration) => (decoration as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class?.includes('nomi-ai-rewrite-del'))
    const deleted = inline.map((decoration) => host.state.doc.textBetween(decoration.from, decoration.to))
    expect(deleted.join('')).toBe('盯着纸条看了很久，才')
    const widgets = found.filter((decoration) => decoration.from === decoration.to)
    // 一个新加的字块 + 一组 ✓ ✕（落在段尾）+ 条的落脚处（段后的块级空位，条是文档流里的一块，不盖住后面的字）
    expect(widgets).toHaveLength(3)
    const positions = widgets.map((widget) => widget.from).sort((a, b) => a - b)
    expect(positions.at(-2)).toBe(P2_TO)
    expect(positions.at(-1)).toBe(P2_TO + 1)
  })

  it('菜单 / 进行中：只把原文那段标成待改，不画新旧对比；条的落脚处在这一段后面', () => {
    openOnSecondParagraph()
    const session = getRewriteSession(host.state)!
    const found = buildRewriteDecorations(host.state.doc, session).find()
    expect(found).toHaveLength(2)
    expect(found.filter((decoration) => decoration.from !== decoration.to).map((decoration) => [decoration.from, decoration.to])).toEqual([[P2_FROM, P2_TO]])
    expect(found.find((decoration) => decoration.from === decoration.to)?.from).toBe(P2_TO + 1)
  })

  it('diff：中文按词切，保留的、删的、加的拼回去分别是原文和新文', () => {
    const parts = diffRewrite(P2, '她慢慢展开纸条。')
    expect(parts.filter((part) => part.kind !== 'add').map((part) => part.text).join('')).toBe(P2)
    expect(parts.filter((part) => part.kind !== 'del').map((part) => part.text).join('')).toBe('她慢慢展开纸条。')
  })
  it('diff：段数不变就一段一段比；段数变了整块比；不管哪种拼回去都是原文和新文', () => {
    const before = ['她盯着纸条看了很久。', '纸上的字被潮气洇开。', '林薇没有回头。'].join('\n')
    const same = ['她盯着纸条。', '纸上的字洇开了。', '林薇没有回头。'].join('\n')
    const merged = ['她盯着纸条，纸上的字洇开了。', '林薇没有回头。'].join('\n')
    for (const next of [same, merged]) {
      const parts = diffRewrite(before, next)
      expect(parts.filter((part) => part.kind !== 'add').map((part) => part.text).join('')).toBe(before)
      expect(parts.filter((part) => part.kind !== 'del').map((part) => part.text).join('')).toBe(next)
    }
    // 第三段没改：整段是 keep，不被前面的改动牵连
    expect(diffRewrite(before, same).some((part) => part.kind === 'keep' && part.text.includes('林薇没有回头'))).toBe(true)
  })

  it('diff：8000 字、段数不变的改写走一段一段比（不再是整块平方级）', () => {
    const line = '夜里的街道，雨一直在下，霓虹灯在积水里碎成一片一片，她没有回头，伞沿压得很低。'
    const original = Array.from({ length: 180 }, (_, index) => index + line).join('\n')
    const rewritten = original.replace(/霓虹灯/g, '灯火').replace(/碎成一片一片/g, '碎了')
    const parts = diffRewrite(original, rewritten)
    // 走的是「一段一段比」：每两段之间都有一个单独的换行 keep（整块比不会拆出这些）。耗时由性能场景 creation-ai-rewrite-result-8000 在真 Electron 里量，这里不用墙钟判分。
    expect(parts.filter((part) => part.kind === 'keep' && part.text === '\n')).toHaveLength(179)
    expect(parts.filter((part) => part.kind !== 'del').map((part) => part.text).join('')).toBe(rewritten)
  })
})

describe('键盘：Enter 接受、Esc 放弃（焦点在文档里时由插件处理）', () => {
  const plugin = createRewritePlugin()
  const press = (key: string, init: Partial<KeyboardEvent> = {}): boolean => {
    const handler = plugin.props.handleKeyDown!
    const view = { get state() { return host.state }, dispatch: (transaction: Transaction) => host.dispatch(transaction) }
    return Boolean(handler.call(plugin, view as never, { key, isComposing: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...init } as KeyboardEvent))
  }

  it('结果态 Enter = 接受', async () => {
    await runToResult()
    expect(press('Enter')).toBe(true)
    expect(host.text()).toBe([P1, '慢慢展开纸条。', P3].join('\n'))
  })

  it('Esc = 放弃，原文不变', async () => {
    await runToResult()
    expect(press('Escape')).toBe(true)
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
    expect(getRewriteSession(host.state)).toBeNull()
  })

  it('输入法组字中的 Enter、没有会话时的 Enter 都不拦', async () => {
    expect(press('Enter')).toBe(false)
    await runToResult()
    expect(press('Enter', { isComposing: true })).toBe(false)
    expect(getRewriteSession(host.state)?.status).toBe('result')
  })

  it('还在改写（没有结果）时 Enter 不接受', async () => {
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    await fake.request(1)
    expect(press('Enter')).toBe(false)
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
  })

  it('进行中光标已移去第一段：按 Esc 仍显式取消请求；结果出来后在第一段按 Enter 不误接受第二段', async () => {
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    host.select(1, 1)
    expect(getRewriteSession(host.state)?.status).toBe('running')
    expect(press('Escape')).toBe(true)
    expect(getRewriteSession(host.state)).toBeNull()
    expect(request.signalAborted()).toBe(true)

    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    const second = await fake.request(2)
    host.select(1, 1)
    second.reply('慢慢展开纸条。')
    await host.until(() => getRewriteSession(host.state)?.status === 'result')
    // 光标还在第一段：按 Enter 是第一段自己的回车，不替第二段点接受
    expect(press('Enter')).toBe(false)
    expect(getRewriteSession(host.state)?.status).toBe('result')
    // 光标回到第二段：按 Enter 接受第二段结果
    host.select(P2_FROM, P2_FROM)
    expect(press('Enter')).toBe(true)
    expect(host.text()).toBe([P1, '慢慢展开纸条。', P3].join('\n'))
  })

  it('结果回包时的焦点保护：用户已去别的段落打字或点去外部控件时不抢焦点；刚开菜单或仍留在本段时正常收焦点', async () => {
    const checkFocus = (rewriteSessionModule as Record<string, unknown>).shouldAutoFocusRewriteInput as
      | ((input: {
          state: EditorState
          session: NonNullable<ReturnType<typeof getRewriteSession>>
          editorFocused: boolean
          barContainsFocus: boolean
          bodyOrNullFocused: boolean
        }) => boolean)
      | undefined
    expect(typeof checkFocus).toBe('function')

    openOnSecondParagraph()
    const menuSession = getRewriteSession(host.state)!
    expect(checkFocus!({ state: host.state, session: menuSession, editorFocused: true, barContainsFocus: false, bodyOrNullFocused: false })).toBe(true)

    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    host.select(1, 1)
    request.reply('慢慢展开纸条。')
    await host.until(() => getRewriteSession(host.state)?.status === 'result')
    const resultSession = getRewriteSession(host.state)!

    // 用户正在第一段打字，或点去了 Agent 输入框等外部控件：结果到达时绝不抢走焦点
    expect(checkFocus!({ state: host.state, session: resultSession, editorFocused: true, barContainsFocus: false, bodyOrNullFocused: false })).toBe(false)
    expect(checkFocus!({ state: host.state, session: resultSession, editorFocused: false, barContainsFocus: false, bodyOrNullFocused: false })).toBe(false)

    // 焦点本来就在改写条里，或编辑器选区仍在待改段内：正常聚焦输入框以便直接按 Enter / Esc
    expect(checkFocus!({ state: host.state, session: resultSession, editorFocused: false, barContainsFocus: true, bodyOrNullFocused: false })).toBe(true)
    host.select(P2_FROM, P2_TO)
    expect(checkFocus!({ state: host.state, session: getRewriteSession(host.state)!, editorFocused: true, barContainsFocus: false, bodyOrNullFocused: false })).toBe(true)
  })
})

describe('给模型的话与写作 Skill', () => {
  const skill = (patch: Partial<SkillListItemDto>): SkillListItemDto => ({
    directoryName: 's', name: 's', label: 'S', description: null, author: null, stageLabels: [], isPlaybook: false,
    neededProviders: [], manifestError: null, origin: 'user', packageVersion: '1', contentHash: 'h', ...patch,
  } as SkillListItemDto)

  it('只收用户自己的、不要图 / 视频模型的单段 Skill', () => {
    expect(isWritingSkill(skill({}))).toBe(true)
    expect(isWritingSkill(skill({ neededProviders: ['text'] }))).toBe(true)
    expect(isWritingSkill(skill({ origin: 'builtin' }))).toBe(false)
    expect(isWritingSkill(skill({ isPlaybook: true }))).toBe(false)
    expect(isWritingSkill(skill({ neededProviders: ['image'] }))).toBe(false)
    expect(isWritingSkill(skill({ manifestError: 'bad' }))).toBe(false)
  })

  it('提示词带原文、要求，挂了 Skill 就带 Skill 的方法正文（不带 frontmatter）', () => {
    const body = skillBodyText('---\nname: kasdan\n---\n多用动作少用形容词。')
    expect(body).toBe('多用动作少用形容词。')
    const prompt = buildRewritePrompt({ original: P2, instruction: '按「编剧」改', skill: { key: 'kasdan', title: '编剧', body } })
    expect(prompt).toContain(P2)
    expect(prompt).toContain('多用动作少用形容词。')
    expect(prompt).toContain('按「编剧」改')
  })

  it('剧本模式的专长层当文体约定带进去；纯问答模式和专职模式不带', () => {
    expect(buildRewritePrompt({ original: P2, instruction: '缩短', skill: null, modeId: 'script' })).toContain('△')
    expect(buildRewritePrompt({ original: P2, instruction: '缩短', skill: null, modeId: 'general' })).not.toContain('写作约定')
    expect(buildRewritePrompt({ original: P2, instruction: '缩短', skill: null, modeId: 'storyboard' })).not.toContain('写作约定')
  })

  it('清掉模型多包的代码围栏和外层引号；原文本来就带引号则保留', () => {
    expect(cleanRewriteOutput('```\n新的一段\n```', '旧')).toBe('新的一段')
    expect(cleanRewriteOutput('“新的一段”', '旧')).toBe('新的一段')
    expect(cleanRewriteOutput('“新的一段”', '“旧”')).toBe('“新的一段”')
  })
})

describe('B1：改写结果只落回打开它的那篇文稿（按身份判，不只按内容判）', () => {
  it('改写进行中切到另一篇正文一模一样的文稿：会话作废、请求取消、迟到的结果无处可写，并告诉用户没写入', async () => {
    openOnSecondParagraph()
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    host.switchDocument('doc-B')
    expect(getRewriteSession(host.state)).toBeNull()
    expect(request.signalAborted()).toBe(true)
    expect(discarded).toEqual(['document-switched'])
    request.reply('不该出现的结果')
    await settle()
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
    expect(getRewriteSession(host.state)).toBeNull()
  })

  it('结果已出来后切到另一篇正文一模一样的文稿：结果作废，接受不了，并告诉用户没写入', async () => {
    await runToResult()
    host.switchDocument('doc-B')
    expect(getRewriteSession(host.state)).toBeNull()
    expect(discarded).toEqual(['document-switched'])
    controller.accept()
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
  })

  it('唯一的落地关口自己也认身份：会话身份和当前文稿对不上就不写（即使有人绕过了「切文稿时关会话」）', async () => {
    await runToResult()
    const session = getRewriteSession(host.state)!
    // 绕过关闭：手工塞回一个「属于别的文稿」的会话
    host.dispatch(openRewriteTransaction(host.state, { ...session, documentId: 'doc-OTHER' }))
    controller.accept()
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
    expect(getRewriteSession(host.state)?.status).toBe('result')
  })

  it('整份复制的项目：两个项目里有同 id、同正文的文稿，切项目也作废（身份是「项目 + 文稿」）', async () => {
    host.switchDocument(rewriteDocumentIdentity('project-1', 'doc-A'))
    await runToResult()
    expect(rewriteDocumentIdentity('project-1', 'doc-A')).not.toBe(rewriteDocumentIdentity('project-2', 'doc-A'))
    host.switchDocument(rewriteDocumentIdentity('project-2', 'doc-A'))
    expect(getRewriteSession(host.state)).toBeNull()
    expect(discarded).toEqual(['document-switched'])
    controller.accept()
    expect(host.text()).toBe([P1, P2, P3].join('\n'))
  })

  it('会话在原文稿里照常能接受（身份一致不误杀）', async () => {
    await runToResult()
    host.switchDocument('doc-A')
    expect(getRewriteSession(host.state)?.status).toBe('result')
    controller.accept()
    expect(host.text()).toBe([P1, '慢慢展开纸条。', P3].join('\n'))
    expect(discarded).toEqual([])
  })
})

describe('B2：接受改写是独立的一步撤销', () => {
  it('改写前刚打的字、马上接受改写，Ctrl+Z 只撤回这次改写，刚打的字还在', async () => {
    host.edit(P2_FROM + 3, P2_FROM + 3, 'X') // 刚打的字，紧挨着待改的那段
    host.select(P2_FROM + 4, P2_TO + 1)
    expect(controller.open()).toBe(true)
    controller.submit(REQUIREMENT)
    const request = await fake.request(1)
    request.reply('慢慢展开。')
    await host.until(() => getRewriteSession(host.state)?.status === 'result')
    const typed = host.text()
    controller.accept()
    expect(host.text()).not.toBe(typed)
    host.undo()
    expect(host.text()).toBe(typed)
    expect(host.text()).toContain('X')
  })

  it('接受之后紧接着打字，Ctrl+Z 先撤打的字、再撤改写（两步），互不并组', async () => {
    await runToResult()
    const original = host.text()
    controller.accept()
    const accepted = host.text()
    host.edit(host.state.selection.from, host.state.selection.from, 'Y')
    host.undo()
    expect(host.text()).toBe(accepted)
    host.undo()
    expect(host.text()).toBe(original)
  })
})

describe('会话的唯一 owner 是编辑器插件状态', () => {
  it('会话只活在插件状态里：没有第二份', () => {
    openOnSecondParagraph()
    expect(rewriteSessionKey.getState(host.state)?.session).toBe(getRewriteSession(host.state))
    expect(rangeText(host.state.doc, P2_FROM, P2_TO)).toBe(P2)
  })
})
