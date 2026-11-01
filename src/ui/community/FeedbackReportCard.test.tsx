/**
 * 一键反馈卡的行为测试：真卡 + 记账的桌面桥，用真文案。
 *
 * 守的是用户看到的那几句话：发不出去时他看到什么、留言还在不在、卡会不会卡死、
 * 清单是不是界面语言、勾选框是不是只在真有东西可带时出现。
 * 测试宿主没有 DOM：用仓库已有的 react-reconciler 测试渲染器，按根节点的 React 元素树取文字和回调。
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer, type TestHostNode } from '../../workbench/ai/v4/testReactRenderer'
import { enFeedbackReport, zhFeedbackReport } from '../../i18n/locales/feedbackReport'
import {
  FEEDBACK_EXCLUSION_REASONS,
  FEEDBACK_MANIFEST_ITEMS,
  type FeedbackManifestItem,
  type FeedbackSendResult,
} from '../../../electron/shared/contracts/feedback'
import type { DiagnosticsBundleManifest } from '../../../electron/shared/contracts/diagnostics'

const seen = vi.hoisted(() => ({
  locale: 'zh' as 'zh' | 'en',
  table: {} as Record<string, unknown>,
  send: vi.fn(),
  preview: vi.fn(),
  perf: null as unknown,
}))

function translate(key: string, options?: Record<string, unknown>): string {
  const found = key.replace(/^feedbackReport\./, '').split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    seen.table,
  )
  if (typeof found !== 'string') return `MISSING:${key}`
  return found.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''))
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }), initReactI18next: { type: '3rdParty', init: () => undefined } }))
vi.mock('../../desktop/bridge', () => {
  // 真桥是同一个对象：每次给新的，卡的「换请求就重置」会一直触发。
  const bridge = {
    feedback: { send: seen.send, preview: seen.preview },
    update: { appInfo: async () => ({ version: '0.24.1', platform: 'win32', arch: 'x64' }) },
  }
  return { getDesktopBridge: () => bridge }
})
vi.mock('../../design', () => ({
  DesignButton: ({ children, disabled }: { children?: React.ReactNode; disabled?: boolean }) => <button disabled={disabled}>{children}</button>,
  DesignCheckbox: ({ label }: { label?: React.ReactNode }) => <label>{label}</label>,
  DesignTextInput: ({ value }: { value?: string }) => <input value={value} readOnly />,
}))
vi.mock('../../workbench/observability/perfCollector', () => ({ snapshotPerfSummary: () => seen.perf }))

import { FeedbackReportCard } from './FeedbackReportCard'

type AnyProps = Record<string, unknown> & { children?: React.ReactNode }
type Host = TestHostNode & { type: string }

const LANE_REQUEST = { surface: 'agent', summary: 'Agent 这一轮失败了', laneName: 'winter-bus', projectId: 'p1' } as const
const PLAIN_REQUEST = { surface: 'generation', summary: '生成失败了' } as const

function manifest(overrides: Partial<DiagnosticsBundleManifest> = {}): DiagnosticsBundleManifest {
  return {
    schemaVersion: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    app: { version: '0.24.1', electron: '43', node: '22', chrome: '130' },
    system: { platform: 'win32', arch: 'x64', osRelease: '10', locale: 'zh-CN', timeZone: 'Asia/Shanghai' },
    projectId: null,
    entries: [{ path: FEEDBACK_MANIFEST_ITEMS.logTail, bytes: 10, what: '主进程写的中文说明' }],
    excluded: [
      { what: FEEDBACK_MANIFEST_ITEMS.secrets, why: 'never-collected-by-design' },
      { what: FEEDBACK_MANIFEST_ITEMS.content, why: 'content-checkbox-not-ticked' },
    ],
    totalBytes: 10,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('FeedbackReportCard', () => {
  let hosts: Host[]
  let renderer: ReturnType<typeof createReactTestRenderer>
  const onDone = vi.fn()

  const tick = () => new Promise<void>((resolve) => { setImmediate(resolve) })
  const settle = async () => {
    for (let index = 0; index < 5; index += 1) {
      await tick()
      renderer.flushPassiveEffects()
    }
  }
  const card = (): AnyProps => {
    const root = hosts.find((host) => host.type === 'div' && 'data-feedback-card' in (host.props as AnyProps))
    if (!root) throw new Error('卡没有渲染出来')
    return root.props as AnyProps
  }
  const walk = (node: React.ReactNode, visit: (props: AnyProps) => void): void => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return
      const props = child.props as AnyProps
      visit(props)
      walk(props.children, visit)
    })
  }
  const find = (attribute: string): AnyProps | null => {
    let hit: AnyProps | null = null
    walk(card().children, (props) => { if (attribute in props && !hit) hit = props })
    return hit
  }
  const findAll = (attribute: string): AnyProps[] => {
    const hits: AnyProps[] = []
    walk(card().children, (props) => { if (attribute in props) hits.push(props) })
    return hits
  }
  const text = (node: React.ReactNode = card().children): string =>
    renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
  const phase = (): unknown => card()['data-feedback-phase']
  const mount = async (request: Parameters<typeof FeedbackReportCard>[0]['request']): Promise<void> => {
    renderer.render(<FeedbackReportCard request={request} onDone={onDone} />)
    await settle()
  }
  const press = async (): Promise<void> => {
    ;(find('data-feedback-send')?.onClick as () => void)()
    await settle()
  }
  const typeNote = async (value: string): Promise<void> => {
    ;(find('data-feedback-note')?.onChange as (event: unknown) => void)({ currentTarget: { value } })
    await settle()
  }
  const view = async (): Promise<void> => {
    ;(find('data-feedback-view')?.onClick as () => void)()
    await settle()
  }
  const tickContent = async (checked: boolean): Promise<void> => {
    ;(find('data-feedback-include-content')?.onChange as (event: unknown) => void)({ currentTarget: { checked } })
    await settle()
  }

  beforeEach(() => {
    seen.locale = 'zh'
    seen.table = zhFeedbackReport
    seen.send.mockReset()
    seen.preview.mockReset().mockResolvedValue({ manifest: manifest() })
    seen.perf = null
    onDone.mockReset()
    hosts = []
    vi.stubGlobal('window', {
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
      location: { hash: '', search: '' },
      localStorage: { getItem: () => null, setItem: () => undefined },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })
    renderer = createReactTestRenderer<Host>({
      createInstance: (type, props) => {
        const host = { type, props }
        hosts.push(host)
        return host
      },
    })
  })
  afterEach(() => {
    renderer.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('发送后用户看到什么', () => {
    it('送到了：一行编号，短留一会儿', async () => {
      seen.send.mockResolvedValue({ ok: true, id: 'NF-1101-0001', queued: false, trimmed: false } satisfies FeedbackSendResult)
      await mount(PLAIN_REQUEST)
      await press()
      expect(phase()).toBe('sent')
      expect(text()).toBe('已发送 NF-1101-0001')
      expect(onDone).toHaveBeenCalledWith(2_200)
    })

    it('没连上：说清已存本机、会自动重发（不再说「联网后」，那是假话：之前要等重启），多留一会儿让人读完', async () => {
      seen.send.mockResolvedValue({ ok: true, id: null, queued: true, trimmed: false } satisfies FeedbackSendResult)
      await mount(PLAIN_REQUEST)
      await press()
      expect(phase()).toBe('queued')
      expect(text()).toBe(zhFeedbackReport.queued)
      expect(onDone).toHaveBeenCalledWith(5_000)
    })

    it('超限：编号之外明说有东西没带上', async () => {
      seen.send.mockResolvedValue({ ok: true, id: 'NF-1101-0002', queued: false, trimmed: true } satisfies FeedbackSendResult)
      await mount(PLAIN_REQUEST)
      await press()
      expect(text()).toBe(`已发送 NF-1101-0002 ${zhFeedbackReport.trimmedNote}`)
      expect(onDone).toHaveBeenCalledWith(5_000)
    })

    it('确实发不出去：说实话，留言还在，能再点一次，再点带着同一句留言', async () => {
      seen.send.mockResolvedValueOnce({ ok: false, reason: 'failed' } satisfies FeedbackSendResult)
      await mount(PLAIN_REQUEST)
      await typeNote('我刚换了模型')
      await press()
      expect(phase()).toBe('failed')
      expect(text(find('data-feedback-error')?.children)).toBe(zhFeedbackReport.failed)
      expect(find('data-feedback-note')?.value).toBe('我刚换了模型')
      expect(find('data-feedback-send')?.disabled).toBe(false)
      expect(onDone).not.toHaveBeenCalled()

      seen.send.mockResolvedValueOnce({ ok: true, id: 'NF-1101-0003', queued: false, trimmed: false } satisfies FeedbackSendResult)
      await press()
      expect(seen.send.mock.calls[1][0]).toMatchObject({ note: '我刚换了模型' })
      expect(phase()).toBe('sent')
    })

    it('桥抛错也一样', async () => {
      seen.send.mockRejectedValue(new Error('ipc'))
      await mount(PLAIN_REQUEST)
      await press()
      expect(phase()).toBe('failed')
    })

    it('这个构建没配接收端：说清楚，并给出下一步', async () => {
      seen.send.mockResolvedValue({ ok: false, reason: 'endpoint-unconfigured' } satisfies FeedbackSendResult)
      await mount(PLAIN_REQUEST)
      await press()
      expect(phase()).toBe('unconfigured')
      expect(text(find('data-feedback-error')?.children)).toBe(zhFeedbackReport.unconfigured)
    })

    it('发送中按钮锁住，不能连点', async () => {
      seen.send.mockReturnValue(new Promise(() => undefined))
      await mount(PLAIN_REQUEST)
      await press()
      expect(phase()).toBe('sending')
      expect(find('data-feedback-send')?.disabled).toBe(true)
      expect(text(find('data-feedback-send')?.children)).toBe(zhFeedbackReport.sending)
    })

    it('主进程一直不回答：20 秒后卡解锁，不会永远停在「正在发送…」', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      seen.send.mockReturnValue(new Promise(() => undefined))
      await mount(PLAIN_REQUEST)
      await typeNote('留言')
      await press()
      expect(phase()).toBe('sending')
      await vi.advanceTimersByTimeAsync(19_000)
      await settle()
      expect(phase()).toBe('sending')
      await vi.advanceTimersByTimeAsync(1_000)
      await settle()
      expect(phase()).toBe('failed')
      expect(find('data-feedback-send')?.disabled).toBe(false)
      expect(find('data-feedback-note')?.value).toBe('留言')
    })

    it('卡已经换成新请求：上一次发送晚到的回答不许动新卡，也不许把它关掉', async () => {
      const late = deferred<FeedbackSendResult>()
      seen.send.mockReturnValue(late.promise)
      await mount(PLAIN_REQUEST)
      await press()
      await mount({ surface: 'import', summary: '导入被拒了' })
      expect(phase()).toBe('idle')
      late.resolve({ ok: true, id: 'NF-1101-0004', queued: false, trimmed: false })
      await settle()
      expect(phase()).toBe('idle')
      expect(onDone).not.toHaveBeenCalled()
    })
  })

  describe('同意页说的是实情', () => {
    it('问题不在对话里：没有勾选框，「附带」里也没有工具轨迹', async () => {
      await mount(PLAIN_REQUEST)
      expect(find('data-feedback-include-content')).toBeNull()
      expect(text(find('data-feedback-attaches')?.children)).toBe('附带 日志 · 模型目录')
    })

    it('问题在对话里：有勾选框，默认不勾，「附带」里有工具轨迹', async () => {
      await mount(LANE_REQUEST)
      expect(find('data-feedback-include-content')?.checked).toBe(false)
      expect(text(find('data-feedback-attaches')?.children)).toBe('附带 日志 · 模型目录 · 工具轨迹')
    })

    it('攒够卡顿数据才说带卡顿数字', async () => {
      seen.perf = { page: 'generation' }
      await mount(PLAIN_REQUEST)
      expect(text(find('data-feedback-attaches')?.children)).toBe('附带 日志 · 模型目录 · 卡顿数字')
    })

    it('清单加载时说「正在整理」，不说「没算出来」', async () => {
      const pending = deferred<{ manifest: DiagnosticsBundleManifest }>()
      seen.preview.mockReturnValue(pending.promise)
      await mount(LANE_REQUEST)
      await view()
      expect(text(find('data-feedback-manifest')?.children)).toBe(zhFeedbackReport.manifestLoading)
      pending.resolve({ manifest: manifest() })
      await settle()
      expect(text(find('data-feedback-manifest')?.children)).toContain('最近的运行日志')
    })

    it('清单真的算不出来才说算不出来', async () => {
      seen.preview.mockRejectedValue(new Error('ipc'))
      await mount(LANE_REQUEST)
      await view()
      expect(text(find('data-feedback-manifest')?.children)).toBe(zhFeedbackReport.manifestUnavailable)
    })

    it('勾选之后清单跟着变：点发送前看到的要是实情', async () => {
      seen.preview.mockImplementation(async (request: { includeContent?: boolean }) => ({
        manifest: request.includeContent
          ? manifest({
              entries: [{ path: FEEDBACK_MANIFEST_ITEMS.trajectory, bytes: 10, what: 'x' }],
              excluded: [{ what: FEEDBACK_MANIFEST_ITEMS.secrets, why: 'never-collected-by-design' }],
            })
          : manifest({
              entries: [{ path: FEEDBACK_MANIFEST_ITEMS.trajectory, bytes: 10, what: 'x' }],
            }),
      }))
      await mount(LANE_REQUEST)
      await view()
      expect(text(find('data-feedback-manifest')?.children)).toContain(zhFeedbackReport.manifestItem.trajectory)
      await tickContent(true)
      expect(seen.preview).toHaveBeenCalledTimes(2)
      expect(text(find('data-feedback-manifest')?.children)).toContain(zhFeedbackReport.manifestTrajectoryWithContent)
      expect(text(find('data-feedback-manifest')?.children)).not.toContain(zhFeedbackReport.manifestItem.content)
    })

    it('打字不重算清单', async () => {
      await mount(LANE_REQUEST)
      await view()
      await typeNote('补一句')
      expect(seen.preview).toHaveBeenCalledTimes(1)
    })

    it('勾选的旧清单晚到时不盖掉新的', async () => {
      const slow = deferred<{ manifest: DiagnosticsBundleManifest }>()
      seen.preview.mockReturnValueOnce(slow.promise)
      seen.preview.mockResolvedValueOnce({ manifest: manifest({ excluded: [] }) })
      await mount(LANE_REQUEST)
      await view()
      await tickContent(true)
      slow.resolve({ manifest: manifest() })
      await settle()
      expect(findAll('data-feedback-why')).toEqual([])
    })
  })

  describe('清单的语言', () => {
    for (const [locale, table] of [['zh', zhFeedbackReport], ['en', enFeedbackReport]] as const) {
      it(`${locale}：每个条目和每个原因都是界面语言，不露机器码`, async () => {
        seen.locale = locale
        seen.table = table
        const items = Object.values(FEEDBACK_MANIFEST_ITEMS)
        seen.preview.mockResolvedValue({
          manifest: manifest({
            entries: items.slice(0, 4).map((path) => ({ path, bytes: 1, what: '主进程写的中文说明' })),
            excluded: FEEDBACK_EXCLUSION_REASONS.map((why, index) => ({ what: items[index % items.length], why })),
          }),
        })
        await mount(LANE_REQUEST)
        await view()
        const shown = text(find('data-feedback-manifest')?.children)
        expect(shown).not.toContain('MISSING')
        expect(shown).not.toContain('主进程写的中文说明')
        for (const why of FEEDBACK_EXCLUSION_REASONS) expect(shown).not.toContain(why)
        for (const row of findAll('data-feedback-excluded')) {
          const rowText = text(row.children)
          if (locale === 'en') expect(rowText).not.toMatch(/[一-鿿]/)
          else expect(rowText).toMatch(/[一-鿿]/)
        }
        // 机器码还留在属性上，走查和排查靠它。
        expect(findAll('data-feedback-why').map((row) => row['data-feedback-why'])).toEqual([...FEEDBACK_EXCLUSION_REASONS])
      })
    }

    it('两种语言的表逐项齐全（编译期也拦，这里防有人绕过类型）', () => {
      const items = Object.keys(FEEDBACK_MANIFEST_ITEMS) as FeedbackManifestItem[]
      for (const table of [zhFeedbackReport, enFeedbackReport]) {
        for (const item of items) expect(table.manifestItem[item]).toBeTruthy()
        for (const why of FEEDBACK_EXCLUSION_REASONS) expect(table.manifestWhy[why]).toBeTruthy()
      }
    })

    it('英文界面的「没连上」和「没能确认」是英文', async () => {
      seen.locale = 'en'
      seen.table = enFeedbackReport
      seen.send.mockResolvedValue({ ok: true, id: null, queued: true, trimmed: false } satisfies FeedbackSendResult)
      await mount(PLAIN_REQUEST)
      await press()
      expect(text()).toBe(enFeedbackReport.queued)
    })
  })
})
