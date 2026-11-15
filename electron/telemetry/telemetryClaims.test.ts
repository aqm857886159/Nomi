// 「对用户说了什么」与「实际收什么」不许各写各的：
//   · 对外文案（README、官网生成脚本）不许再出现绝对的「不上报 / no telemetry」——产品有可选匿名统计；
//   · 凡是需要告知范围 ≥2 的事件，设置页说明与同意卡里必须有对应的人话（流畅度 / smoothness）。
// 之前这两处各自手写，README 写「no telemetry」时产品已经有可选遥测，没有任何东西核对过。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { zhAgentPanelV4, enAgentPanelV4 } from '../../src/i18n/locales/agentPanelV4'
import { zhSettings, enSettings } from '../../src/i18n/locales/settings'
import { isTelemetryProps, TELEMETRY_EVENT_MIN_SCOPE, TELEMETRY_EVENT_NAMES, TELEMETRY_SCOPE_VERSION, type TelemetryEventName } from './telemetryEvents'

const root = path.resolve(__dirname, '../..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('遥测告知口径', () => {
  it('对外文案没有绝对的「不上报 / no telemetry」', () => {
    const files = ['README.md', 'README.zh-CN.md', 'scripts/marketing/content.mjs', 'scripts/marketing/features.mjs']
    for (const file of files) {
      expect(read(file), file).not.toMatch(/no telemetry|不上报数据/i)
    }
  })

  it('告知范围版本号与事件登记表对得上：最高要求版本 = 当前版本', () => {
    expect(Math.max(...Object.values(TELEMETRY_EVENT_MIN_SCOPE))).toBe(TELEMETRY_SCOPE_VERSION)
  })

  it('范围 2 的数据（流畅度分档）在设置页说明与同意卡里都有人话', () => {
    const settings = read('src/i18n/locales/settings.ts')
    expect(settings).toContain('界面流畅度')
    expect(settings).toContain('smoothness figures')
    expect(zhAgentPanelV4.consent.collects).toContain('卡不卡')
    expect(zhAgentPanelV4.consent.scopeCollects).toContain('点击多久有反应')
    expect(enAgentPanelV4.consent.collects).toContain('smooth')
    expect(enAgentPanelV4.consent.scopeTitle).toContain('smoothness')
  })

  // ── 设置页「查看完整清单」与事件定义对账（2026-11-13）──
  // 每个事件的每一格都要在中英两版说明里找得到一句人话；事件或格子加了 / 删了，这张表不跟着改就红。
  // 表里的样例是每个事件「格子最全」的合法形状，用真校验器验过，所以表和白名单不会各说各的。
  const generationFull = { capability: 'video', durationBucket: '>5s', result: 'failure', mode: 'reference', modelClass: 'custom', submitDuration: 'lt-1s', waitDuration: 'none', upstreamStatus: 'not-sent', errorType: 'local-refusal', failureStage: 'submit', localRefusal: 'asset-too-large' }
  const DISCLOSURE: Record<TelemetryEventName, { samples: Record<string, unknown>[]; fields: Record<string, [zh: string, en: string]> }> = {
    'app.started': {
      samples: [{ appMajor: 0, appMinor: 25, osFamily: 'macos', locale: 'en', lastExit: 'renderer-crashed' }],
      fields: { appMajor: ['版本号', 'version number'], appMinor: ['版本号', 'version number'], osFamily: ['操作系统', 'operating system'], locale: ['语言', 'language'], lastExit: ['上一次是正常退出还是崩溃', 'previous session quit normally or crashed'] },
    },
    'generation.completed': {
      samples: [generationFull, { ...generationFull, upstreamStatus: 'server-5xx', failureStage: 'wait', localRefusal: undefined }],
      fields: {
        capability: ['哪类能力', 'which capability'], mode: ['哪种方式', 'which mode'], modelClass: ['内置的还是自己接的', 'built in or one you connected'], result: ['成没成功', 'whether it succeeded'],
        durationBucket: ['耗时区间', 'duration range'], submitDuration: ['各阶段耗时区间', 'duration range for each stage'], waitDuration: ['各阶段耗时区间', 'duration range for each stage'],
        errorType: ['失败类别', 'failure category'], failureStage: ['卡在哪一段', 'which stage it stopped at'], upstreamStatus: ['上游怎么答的', 'how the upstream service answered'], localRefusal: ['本机哪条规则拦下的', 'which local rule stopped it'],
      },
    },
    'export.completed': {
      samples: [{ format: 'mp4', durationBucket: '1-5s', result: 'success' }],
      fields: { format: ['导出的格式', 'export, the format'], durationBucket: ['耗时区间', 'duration range'], result: ['成没成功', 'whether it succeeded'] },
    },
    'update.action': {
      samples: [{ action: 'download', result: 'failure', reason: 'network' }],
      fields: { action: ['检查更新、下载、安装', 'update checks, downloads and installs'], result: ['成没成功', 'succeeded'], reason: ['失败原因类别', 'failure reason category'] },
    },
    'agent.tool.failed': {
      samples: [{ toolName: 'run_generation', failureCode: 'timeout', attempt: 2, breakerTripped: false, modelClass: 'builtin', reason: undefined }],
      fields: { toolName: ['哪个工具', 'which tool'], failureCode: ['失败类别', 'failure category'], attempt: ['第几次重试', 'which retry'], breakerTripped: ['连续失败后是否被拦下', 'whether repeated failures got it blocked'], modelClass: ['内置的还是自己接的', 'built in or one you connected'], reason: ['失败类别和原因分类', 'the failure category and reason category'] },
    },
    'perf.session.summary': {
      samples: [{ interactionP75: '100-200', interactionP95: '200-500', longFramesPerMin: '1-3', longestFrame: '100-250', observedMinutes: '5-30', page: 'generation', nodes: '21-100', imageNodes: '1-20', generating: true, cpuCores: '9-16', memoryGb: '8plus', mainStallMax: '250-1000', mainStallCount: '1-3' }],
      fields: {
        interactionP75: ['点击后多久有反应', 'how long a click takes to respond'], interactionP95: ['点击后多久有反应', 'how long a click takes to respond'], longFramesPerMin: ['掉帧次数', 'dropped frames'], longestFrame: ['掉帧次数', 'dropped frames'], observedMinutes: ['界面流畅度的分档数字', 'bucketed smoothness figures'],
        page: ['当前所在页面', 'current page'], nodes: ['画布规模区间', 'canvas size range'], imageNodes: ['画布规模区间', 'canvas size range'], generating: ['是否正在生成', 'whether a generation is running'],
        cpuCores: ['CPU 核数', 'CPU core'], memoryGb: ['内存的区间', 'memory ranges'], mainStallMax: ['后台主进程卡住多久', 'background main process froze'], mainStallCount: ['后台主进程卡住多久', 'background main process froze'],
      },
    },
  }
  const clean = (sample: Record<string, unknown>) => Object.fromEntries(Object.entries(sample).filter(([, value]) => value !== undefined))

  it('说明清单覆盖每个事件、每一格；样例都过真校验器，格子集合与登记表恰好相等', () => {
    expect(Object.keys(DISCLOSURE).sort()).toEqual([...TELEMETRY_EVENT_NAMES].sort())
    for (const name of TELEMETRY_EVENT_NAMES) {
      const entry = DISCLOSURE[name]
      const seen = new Set<string>()
      for (const sample of entry.samples.map(clean)) {
        expect(isTelemetryProps(sample, name), `${name} 样例不合法：${JSON.stringify(sample)}`).toBe(true)
        for (const key of Object.keys(sample)) seen.add(key)
      }
      // agent.tool.failed / update.action 的可选 reason：只登记、样例里可以不出现。
      const optional = new Set(name === 'agent.tool.failed' ? ['reason'] : [])
      expect([...seen].sort(), name).toEqual(Object.keys(entry.fields).filter((key) => !optional.has(key) || seen.has(key)).sort())
      for (const [field, [zh, en]] of Object.entries(entry.fields)) {
        expect(zhSettings.general.telemetry.detail, `${name}.${field}`).toContain(zh)
        expect(enSettings.general.telemetry.detail, `${name}.${field}`).toContain(en)
      }
    }
  })

  it('删掉的东西不再出现在说明里（功能使用次数、Agent 每一步、轨迹）', () => {
    const zh = [zhSettings.general.telemetry.description, zhSettings.general.telemetry.detail, zhSettings.general.telemetry.statusConfigured].join('\n')
    const en = [enSettings.general.telemetry.description, enSettings.general.telemetry.detail, enSettings.general.telemetry.statusConfigured].join('\n')
    for (const retired of ['功能使用', 'Agent 每一步', '轨迹']) expect(zh).not.toContain(retired)
    for (const retired of ['feature use', 'each Agent step', 'tool traces', 'traces']) expect(en).not.toContain(retired)
    // Agent 面板同意卡里说「收什么」的那一句同理：已删的「功能使用」不许回来，耗时 / 出错类别要说。
    expect(zhAgentPanelV4.consent.collects).not.toContain('功能')
    expect(enAgentPanelV4.consent.collects).not.toContain('features')
    for (const word of ['耗时', '出错类别']) expect(zhAgentPanelV4.consent.collects).toContain(word)
    for (const word of ['durations', 'error categories']) expect(enAgentPanelV4.consent.collects).toContain(word)
  })

  it('说明里说不发的东西，没有任何一格装得下（格子都是闭合值或固定分类码）', () => {
    for (const phrase of ['提示词', '文件名', '文件路径', '错误原文']) expect(zhSettings.general.telemetry.detail).toContain(phrase)
    for (const phrase of ['Prompts', 'file names', 'file paths', 'original error text']) expect(enSettings.general.telemetry.detail).toContain(phrase)
    const generation = DISCLOSURE['generation.completed'].samples.map(clean)[1]
    for (const leak of ['/Users/me/shot.png', 'a girl in the rain', 'HTTP 502 from https://x.example']) {
      for (const field of ['mode', 'upstreamStatus', 'failureStage', 'errorType']) expect(isTelemetryProps({ ...generation, [field]: leak }, 'generation.completed'), field).toBe(false)
    }
  })
})
