import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFeedbackReport, FEEDBACK_REPORT_MAX_BYTES, isFeedbackReportRequest, shrinkFeedbackReport, type FeedbackReportDeps } from './feedbackReport'
import type { TrajectoryTurnInput } from '../shared/agentLane/laneTrajectory'
import { FEEDBACK_EXCLUSION_REASONS, FEEDBACK_MANIFEST_ITEMS, type FeedbackReportRequest } from '../shared/contracts/feedback'

const FIXTURE = path.join(__dirname, '../../tests/fixtures/standard-formats/nomi-agent-trace-view/trace.jsonl')
const fixtureTurns = (): TrajectoryTurnInput[] =>
  fs.readFileSync(FIXTURE, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as TrajectoryTurnInput)

function deps(overrides: Partial<FeedbackReportDeps> = {}): FeedbackReportDeps {
  return {
    now: new Date('2026-09-15T02:41:00.000Z'),
    app: { version: '0.22.0', electron: '43.0.0', node: '22.0.0', chrome: '130' },
    system: { platform: 'darwin', arch: 'arm64', osRelease: '25.5.0', locale: 'zh-CN', timeZone: 'Asia/Shanghai' },
    projectId: 'winter-bus',
    readLogTail: () => [
      '[2026-09-15T02:40:59.000Z] INFO  tasks          generation-start vendor=apimart model=gpt-5.5',
      '[2026-09-15T02:41:00.000Z] WARN  tasks          generation-failed status=500 absolutePath=/Users/aoqimin/Documents/Nomi Projects/winter-bus/refs/glass-fog.png reason=sk-live-9QhT2mVx7Zb4Lp0RwEaYcN1sKdJf',
    ],
    // nomi-secret-scan:allow 这是金测试的合成靶子（同 tests/fixtures 里那份 trace.jsonl），不是任何真实账号的 key；它存在的意义就是被断言「不许出现在产物里」
    readModelCatalog: () => ({ vendors: [{ key: 'apimart', enabled: true }], apiKeysByVendor: { apimart: { vendorKey: 'apimart', apiKey: 'sk-live-9QhT2mVx7Zb4Lp0RwEaYcN1sKdJf', enabled: true } } }),
    readTrajectory: async () => fixtureTurns(),
    ...overrides,
  }
}

const request: FeedbackReportRequest = {
  surface: 'model-validation',
  summary: '模型验证失败：接口地址返回 404',
  errorCode: 'adapter_probe_not_found',
  laneName: 'winter-bus-lane',
}

describe('一键反馈组包', () => {
  it('入参守卫：面必须在四个里，摘要不许空', () => {
    expect(isFeedbackReportRequest(request)).toBe(true)
    expect(isFeedbackReportRequest({ ...request, surface: 'timeline' })).toBe(false)
    expect(isFeedbackReportRequest({ ...request, summary: '   ' })).toBe(false)
    expect(isFeedbackReportRequest({ ...request, note: 42 })).toBe(false)
    expect(isFeedbackReportRequest(null)).toBe(false)
  })

  it('清单逐项写 what、排除项逐条写 why，且清单与附件一一对应', async () => {
    const report = await buildFeedbackReport(request, deps())
    expect(report.manifest.entries.map((entry) => entry.path).sort())
      .toEqual(['logs/tail.txt', 'model-catalog.json', 'trajectory/turns.json'])
    for (const entry of report.manifest.entries) {
      expect(entry.what.length).toBeGreaterThan(4)
      expect(entry.bytes).toBeGreaterThan(0)
      expect(Object.hasOwn(report.attachments, entry.path)).toBe(true)
    }
    // 清单里没写的格子不许存在。
    expect(Object.keys(report.attachments).sort()).toEqual(report.manifest.entries.map((entry) => entry.path).sort())
    const why = report.manifest.excluded.map((item) => item.why)
    expect(why).toContain('never-collected-by-design')
    expect(why).toContain('content-checkbox-not-ticked')
    expect(why).toContain('available-only-via-settings-diagnostics-export')
  })

  it('密钥、路径、提示词在整包里零命中（没勾内容）', async () => {
    const serialized = JSON.stringify(await buildFeedbackReport(request, deps()))
    expect(serialized).not.toContain('sk-live-9QhT2mVx7Zb4Lp0RwEaYcN1sKdJf')
    expect(serialized).not.toContain('/Users/aoqimin/Documents/Nomi Projects/winter-bus')
    expect(serialized).not.toContain('末班公交车上只剩两个人')
    expect(serialized).not.toContain('iVBORw0KGgoAAAANSUhEUgAA')
  })

  it('勾了内容：清单那一行的 what 明说是用户勾选带上的，信封也记一笔', async () => {
    const report = await buildFeedbackReport({ ...request, includeContent: true }, deps())
    expect(report.context.contentIncluded).toBe(true)
    const trajectory = report.manifest.entries.find((entry) => entry.path === 'trajectory/turns.json')
    expect(trajectory?.what).toContain('勾选')
    expect(report.manifest.excluded.map((item) => item.what)).not.toContain(FEEDBACK_MANIFEST_ITEMS.content)
    // 即便勾了，密钥与路径仍然不出门。
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('sk-live-9QhT2mVx7Zb4Lp0RwEaYcN1sKdJf')
    expect(serialized).not.toContain('/Users/aoqimin/Documents/Nomi Projects/winter-bus')
  })

  it('摘要与留言也过第二道网：调用处传进来的人话可能带着服务商原话里的一段 URL', async () => {
    const report = await buildFeedbackReport({
      ...request,
      summary: '模型验证失败：https://my-private-relay.internal/v1/chat?key=abc123456789 返回 404',
      note: '我用 https://user-written.internal ，把参考图放在 /Users/aoqimin/Desktop/ref.mov 就出这个',
    }, deps())
    expect(report.context.summary).not.toContain('key=abc123456789')
    expect(report.context.summary).not.toContain('my-private-relay.internal')
    expect(report.context.summary).toContain('模型验证失败')
    expect(report.context.note).not.toContain('/Users/aoqimin/Desktop/ref.mov')
    expect(report.context.note).toContain('参考图')
    expect(report.context.note).toContain('user-written.internal')
  })

  it('留言空 → null，不发一个空串让接收端去判断', async () => {
    expect((await buildFeedbackReport({ ...request, note: '   ' }, deps())).context.note).toBeNull()
    expect((await buildFeedbackReport(request, deps())).context.note).toBeNull()
  })

  it('错误码形状不对就丢掉（它只用来聚类，不显示）', async () => {
    expect((await buildFeedbackReport({ ...request, errorCode: '接口 404' }, deps())).context.errorCode).toBeNull()
    expect((await buildFeedbackReport(request, deps())).context.errorCode).toBe('adapter_probe_not_found')
  })

  it('用户自建中转的 key 塌成字面量 custom，不带出私有域名', async () => {
    const report = await buildFeedbackReport({ ...request, provider: 'internal proxy corp.local', model: '我的模型' }, deps())
    expect(report.context.provider).toBe('custom')
    expect(report.context.model).toBeNull()
    const passthrough = await buildFeedbackReport({ ...request, provider: 'apimart', model: 'gpt-5.5' }, deps())
    expect(passthrough.context.provider).toBe('apimart')
    expect(passthrough.context.model).toBe('gpt-5.5')
  })

  it('本机那几家：家留着，模型名不带，它可能是用户自己起的', async () => {
    const report = await buildFeedbackReport({ ...request, provider: 'comfyui-local', model: 'comfy-my-portrait-1' }, deps())
    expect(report.context.provider).toBe('comfyui-local')
    expect(report.context.model).toBeNull()
  })

  it('取不到的东西写进 excluded 而不是静默消失', async () => {
    const report = await buildFeedbackReport({ ...request, laneName: undefined }, deps({
      readLogTail: () => null,
      readModelCatalog: () => null,
    }))
    expect(report.manifest.entries).toHaveLength(0)
    const map = new Map(report.manifest.excluded.map((item) => [item.what, item.why]))
    expect(map.get('logs/tail.txt')).toBe('logs-unavailable')
    expect(map.get('model-catalog.json')).toBe('catalog-unavailable')
    expect(map.get('trajectory/turns.json')).toBe('no-conversation-in-context')
  })

  it('轨迹取料抛异常不炸整包，只是那一项被排除', async () => {
    const report = await buildFeedbackReport(request, deps({
      readTrajectory: async () => { throw new Error('lane locked') },
    }))
    expect(report.manifest.excluded.find((item) => item.what === 'trajectory/turns.json')?.why).toBe('trajectory-unavailable')
    expect(report.manifest.entries.map((entry) => entry.path)).not.toContain('trajectory/turns.json')
  })

  it('超预算的那一项被排除并写明 report-size-limit，不是悄悄截断', async () => {
    const huge = Array.from({ length: 40_000 }, (_item, index) => `[2026-09-15T02:40:59.000Z] INFO  main           noise-${index} status=${'x'.repeat(40)}`)
    const report = await buildFeedbackReport(request, deps({ readLogTail: () => huge }))
    const paths = report.manifest.entries.map((entry) => entry.path)
    const excluded = report.manifest.excluded.filter((item) => item.why === 'report-size-limit').map((item) => item.what)
    expect(paths.length + excluded.length).toBe(3)
    expect(excluded).toEqual([FEEDBACK_MANIFEST_ITEMS.logTail])
    expect(report.manifest.totalBytes).toBeLessThanOrEqual(FEEDBACK_REPORT_MAX_BYTES)
  })

  it('超预算时先牺牲最大的目录，日志和轨迹这些小而有用的留着', async () => {
    const report = await buildFeedbackReport(request, deps({
      readModelCatalog: () => ({ vendors: [{ key: 'apimart' }], models: [{ vendorKey: 'apimart', labelZh: 'a b '.repeat(FEEDBACK_REPORT_MAX_BYTES / 4) }] }),
    }))
    expect(report.manifest.entries.map((entry) => entry.path).sort()).toEqual([FEEDBACK_MANIFEST_ITEMS.logTail, FEEDBACK_MANIFEST_ITEMS.trajectory])
    expect(report.manifest.excluded).toContainEqual({ what: FEEDBACK_MANIFEST_ITEMS.modelCatalog, why: 'report-size-limit' })
  })

  it('清单里写的条目和原因都在契约表里：界面按这张表翻译，漏一个就会露出机器码', async () => {
    const reports = await Promise.all([
      buildFeedbackReport(request, deps()),
      buildFeedbackReport({ ...request, includeContent: true, laneName: undefined }, deps({ readLogTail: () => null, readModelCatalog: () => null })),
      buildFeedbackReport(request, deps({ readLogTail: () => [], readTrajectory: async () => null, trajectoryTimeoutMs: 5 })),
      buildFeedbackReport({ ...request, includeContent: true }, deps({ readTrajectory: () => new Promise(() => undefined), trajectoryTimeoutMs: 5 })),
    ])
    const names: readonly string[] = Object.values(FEEDBACK_MANIFEST_ITEMS)
    for (const { manifest } of [...reports, { manifest: shrinkFeedbackReport(reports[0])!.manifest }]) {
      for (const entry of manifest.entries) expect(names).toContain(entry.path)
      for (const item of manifest.excluded) {
        expect(names).toContain(item.what)
        expect(FEEDBACK_EXCLUSION_REASONS).toContain(item.why)
      }
    }
  })
  it('卡顿数字：请求带了就进包并写进清单；没带就在排除里写明原因；形状不对的整请求不收', async () => {
    const perf = { interactionP75: '100-200', interactionP95: '200-500', longFramesPerMin: '1-3', longestFrame: '100-250', observedMinutes: '5-30', page: 'generation', nodes: '21-100', imageNodes: '1-20', generating: true, cpuCores: '9-16', memoryGb: '8plus' } as const
    const withPerf = await buildFeedbackReport({ ...request, perf }, deps())
    expect(withPerf.attachments['perf/summary.json']).toEqual(perf)
    expect(withPerf.manifest.entries.map((entry) => entry.path)).toContain('perf/summary.json')
    const without = await buildFeedbackReport(request, deps())
    expect(without.attachments['perf/summary.json']).toBeUndefined()
    expect(without.manifest.excluded).toContainEqual({ what: 'perf/summary.json', why: 'perf-unavailable' })
    expect(isFeedbackReportRequest({ ...request, perf })).toBe(true)
    expect(isFeedbackReportRequest({ ...request, perf: { ...perf, gpu: 'RTX' } })).toBe(false)
  })

  describe('日志尾巴', () => {
    it('真的带上了，而且只带投影过的（防注入的读取函数绕过投影）', async () => {
      const report = await buildFeedbackReport(request, deps())
      const lines = report.attachments[FEEDBACK_MANIFEST_ITEMS.logTail] as string[]
      expect(lines).toHaveLength(2)
      expect(lines[0]).toBe('[2026-09-15T02:40:59.000Z] INFO tasks generation-start vendor=apimart model=gpt-5.5')
      expect(lines[1]).toContain('status=500')
      expect(lines[1]).not.toContain('winter-bus')
      expect(lines[1]).not.toContain('sk-live')
      expect(report.manifest.entries.find((entry) => entry.path === FEEDBACK_MANIFEST_ITEMS.logTail)?.what).toContain('最近 2 行')
    })

    it('没有日志和读不了日志是两件事', async () => {
      const why = async (readLogTail: FeedbackReportDeps['readLogTail']) =>
        (await buildFeedbackReport(request, deps({ readLogTail }))).manifest.excluded.find((item) => item.what === FEEDBACK_MANIFEST_ITEMS.logTail)?.why
      expect(await why(() => [])).toBe('logs-empty')
      expect(await why(() => ['认不出形状的行'])).toBe('logs-empty')
      expect(await why(() => null)).toBe('logs-unavailable')
      expect(await why(() => { throw new Error('EACCES') })).toBe('logs-unavailable')
    })
  })

  describe('一项出错只排除那一项', () => {
    it('目录读取抛了', async () => {
      const report = await buildFeedbackReport(request, deps({ readModelCatalog: () => { throw new Error('boom') } }))
      expect(report.manifest.excluded).toContainEqual({ what: FEEDBACK_MANIFEST_ITEMS.modelCatalog, why: 'catalog-unavailable' })
      expect(report.manifest.entries.map((entry) => entry.path)).toContain(FEEDBACK_MANIFEST_ITEMS.logTail)
    })

    it('轨迹形状坏了', async () => {
      const report = await buildFeedbackReport(request, deps({ readTrajectory: async () => [null] as never }))
      expect(report.manifest.excluded).toContainEqual({ what: FEEDBACK_MANIFEST_ITEMS.trajectory, why: 'trajectory-unavailable' })
      expect(report.manifest.entries.map((entry) => entry.path)).toContain(FEEDBACK_MANIFEST_ITEMS.logTail)
    })

    it('轨迹读取同步抛也接得住', async () => {
      const report = await buildFeedbackReport(request, deps({ readTrajectory: () => { throw new Error('boom') } }))
      expect(report.manifest.excluded).toContainEqual({ what: FEEDBACK_MANIFEST_ITEMS.trajectory, why: 'trajectory-unavailable' })
    })
  })

  describe('轨迹等不到头', () => {
    it('到点就不等了，写明原因，报告照发（否则界面永远停在「正在发送…」）', async () => {
      const report = await buildFeedbackReport(request, deps({ readTrajectory: () => new Promise(() => undefined), trajectoryTimeoutMs: 5 }))
      expect(report.manifest.excluded).toContainEqual({ what: FEEDBACK_MANIFEST_ITEMS.trajectory, why: 'trajectory-timeout' })
      expect(report.manifest.entries.map((entry) => entry.path)).toContain(FEEDBACK_MANIFEST_ITEMS.logTail)
    })
  })

  describe('contentIncluded 说的是实情', () => {
    const contentWhy = (report: Awaited<ReturnType<typeof buildFeedbackReport>>) =>
      report.manifest.excluded.find((item) => item.what === FEEDBACK_MANIFEST_ITEMS.content)?.why

    it('没勾', async () => {
      const report = await buildFeedbackReport(request, deps())
      expect(report.context.contentIncluded).toBe(false)
      expect(contentWhy(report)).toBe('content-checkbox-not-ticked')
    })

    it('不在对话里：卡上没有那个勾，不能说「没勾选」', async () => {
      const report = await buildFeedbackReport({ ...request, laneName: undefined }, deps())
      expect(report.context.contentIncluded).toBe(false)
      expect(contentWhy(report)).toBe('no-conversation-in-context')
    })

    it('勾了也带上了', async () => {
      const report = await buildFeedbackReport({ ...request, includeContent: true }, deps())
      expect(report.context.contentIncluded).toBe(true)
      expect(contentWhy(report)).toBeUndefined()
    })

    it('勾了但这个问题不在对话里（线上 16 份里有勾了却什么都没带的）', async () => {
      const report = await buildFeedbackReport({ ...request, includeContent: true, laneName: undefined }, deps())
      expect(report.context.contentIncluded).toBe(false)
      expect(contentWhy(report)).toBe('no-conversation-in-context')
    })

    it('勾了但轨迹读不到 / 等不到头', async () => {
      const unavailable = await buildFeedbackReport({ ...request, includeContent: true }, deps({ readTrajectory: async () => null }))
      expect(unavailable.context.contentIncluded).toBe(false)
      expect(contentWhy(unavailable)).toBe('trajectory-unavailable')
      const timeout = await buildFeedbackReport({ ...request, includeContent: true }, deps({ readTrajectory: () => new Promise(() => undefined), trajectoryTimeoutMs: 5 }))
      expect(timeout.context.contentIncluded).toBe(false)
      expect(contentWhy(timeout)).toBe('trajectory-timeout')
    })
  })

  describe('模型目录只留有用的映射', () => {
    // 合成靶子。放在变量里：密钥扫描的豁免只减不增，不为假夹具再花一格。
    const syntheticKey = 'sk-live-9QhT2mVx7Zb4Lp0RwEaYcN1sKdJf'
    const catalog = {
      vendors: [{ key: 'apimart' }, { key: 'kie' }, { key: 'replicate' }],
      apiKeysByVendor: { apimart: { apiKey: syntheticKey, enabled: true } },
      mappings: [
        { id: '1', vendorKey: 'apimart' },
        { id: '2', vendorKey: 'kie' },
        { id: '3', vendorKey: 'replicate' },
      ],
    }

    it('配过 key 的留着，其余的只留个数，清单明说', async () => {
      const report = await buildFeedbackReport(request, deps({ readModelCatalog: () => catalog }))
      const attached = report.attachments[FEEDBACK_MANIFEST_ITEMS.modelCatalog] as { mappings: { id: string }[]; mappingsOmitted: number; vendors: unknown[] }
      expect(attached.mappings.map((mapping) => mapping.id)).toEqual(['1'])
      expect(attached.mappingsOmitted).toBe(2)
      expect(attached.vendors).toHaveLength(3)
      expect(report.manifest.entries.find((entry) => entry.path === FEEDBACK_MANIFEST_ITEMS.modelCatalog)?.what).toContain('接口映射只留')
      expect(JSON.stringify(report)).not.toContain(syntheticKey)
    })

    it('这次出问题的那一家也留着，哪怕 key 已经删了', async () => {
      const report = await buildFeedbackReport({ ...request, provider: 'kie' }, deps({ readModelCatalog: () => catalog }))
      const attached = report.attachments[FEEDBACK_MANIFEST_ITEMS.modelCatalog] as { mappings: { id: string }[] }
      expect(attached.mappings.map((mapping) => mapping.id)).toEqual(['1', '2'])
    })

    it('形状不认识就不带，清单写这次没读到', async () => {
      const report = await buildFeedbackReport(request, deps({ readModelCatalog: () => ({ somethingElse: true }) }))
      expect(report.attachments).not.toHaveProperty([FEEDBACK_MANIFEST_ITEMS.modelCatalog])
      expect(report.manifest.excluded).toContainEqual({ what: FEEDBACK_MANIFEST_ITEMS.modelCatalog, why: 'catalog-unavailable' })
    })

    it('给接收端看的那一句也说自建连接不带地址', async () => {
      const report = await buildFeedbackReport(request, deps({ readModelCatalog: () => catalog }))
      expect(report.manifest.entries.find((entry) => entry.path === FEEDBACK_MANIFEST_ITEMS.modelCatalog)?.what).toContain('自建连接不带地址、连接名和密钥；模型名会带，用来查模型配置')
    })
  })

  describe('接收端嫌大时那一份', () => {
    it('附件全去掉，摘要、留言、版本、清单留着，清单写明原因', async () => {
      const report = await buildFeedbackReport({ ...request, note: '补一句', includeContent: true }, deps())
      const smaller = shrinkFeedbackReport(report)
      expect(smaller).not.toBeNull()
      expect(smaller?.attachments).toEqual({})
      expect(smaller?.manifest.entries).toEqual([])
      expect(smaller?.manifest.totalBytes).toBe(0)
      expect(smaller?.manifest.app.version).toBe('0.22.0')
      expect(smaller?.context.summary).toBe(report.context.summary)
      expect(smaller?.context.note).toBe('补一句')
      for (const entry of report.manifest.entries) {
        expect(smaller?.manifest.excluded).toContainEqual({ what: entry.path, why: 'report-size-limit' })
      }
      // 内容也跟着走了，信封不能还说带了。
      expect(smaller?.context.contentIncluded).toBe(false)
      expect(smaller?.manifest.excluded).toContainEqual({ what: FEEDBACK_MANIFEST_ITEMS.content, why: 'report-size-limit' })
      expect(Buffer.byteLength(JSON.stringify(smaller), 'utf8')).toBeLessThan(10_000)
    })

    it('认不出形状的货（旧版本排队的东西）不缩', () => {
      for (const bad of [null, 'x', 1, [], {}, { manifest: {} }, { manifest: { entries: 'x' }, context: {} }]) {
        expect(shrinkFeedbackReport(bad)).toBeNull()
      }
    })
  })
})
