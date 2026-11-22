import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { nomiEntryBadgeText, nomiEntryLook, nomiEntryShortcutPrefix, nomiEntryTooltip, type NomiEntryLook } from './nomiEntryLook'

const look = (over: Partial<Parameters<typeof nomiEntryLook>[0]> = {}): NomiEntryLook => nomiEntryLook({ face: 'idle', pendingCount: 0, unreadCount: 0, open: false, roomy: true, ...over })

describe('nomiEntryLook（NomiEntryTopbar 板 A / B / C 组）', () => {
  it('五种脸 × 有无未读：全表', () => {
    const table = (['idle', 'running', 'done', 'failed'] as const).flatMap((face) => [0, 3].map((unreadCount) => {
      const { status, dot, badge, shape } = look({ face, unreadCount })
      return `${face}+${unreadCount} → ${status} / ${dot ?? '-'} / ${badge ?? '-'} / ${shape}`
    }))
    expect(table).toEqual([
      'idle+0 → idle / - / - / face',
      'idle+3 → unread / unread / - / face',
      'running+0 → running / - / - / face',
      'running+3 → running / unread / - / face',
      'done+0 → done / - / - / face',
      'done+3 → done / unread / - / face',
      'failed+0 → failed / failed / - / face',
      'failed+3 → failed / failed / - / face',
    ])
  })

  it('面板还没发布过（null）当空闲；needs-confirm 不会出现在脸上', () => {
    expect(look({ face: null }).status).toBe('idle')
    expect(look({ face: 'needs-confirm' }).status).toBe('idle')
  })

  it('B3：角标 9 → 「9」，10 → 「9+」，120 → 「9+」', () => {
    expect(nomiEntryBadgeText(1)).toBe('1')
    expect(nomiEntryBadgeText(9)).toBe('9')
    expect(nomiEntryBadgeText(10)).toBe('9+')
    expect(nomiEntryBadgeText(120)).toBe('9+')
    expect(look({ pendingCount: 12, roomy: false }).badge).toBe('9+')
  })

  it('B5：在做 + 等你确认 2 → 脸 running、角标 2（脸不被等你确认顶掉）', () => {
    const value = look({ face: 'running', pendingCount: 2, roomy: false })
    expect(value).toMatchObject({ status: 'running', badge: '2', dot: null, shape: 'face' })
  })

  it('B6：没成 + 等你确认 1 → 角标占角，红点不叠', () => {
    expect(look({ face: 'failed', pendingCount: 1, roomy: false })).toMatchObject({ status: 'failed', badge: '1', dot: null })
  })

  it('C1 / C2 / C4：胶囊 = 有待确认 && 放得下 && 面板没开；其余有待确认 → 脸 + 角标', () => {
    expect(look({ pendingCount: 2, roomy: true })).toMatchObject({ shape: 'capsule', badge: null, dot: null })
    expect(look({ pendingCount: 2, roomy: false })).toMatchObject({ shape: 'face', badge: '2' })
    expect(look({ pendingCount: 2, roomy: true, open: true })).toMatchObject({ shape: 'face', badge: '2' })
    expect(look({ pendingCount: 2, roomy: false, open: true })).toMatchObject({ shape: 'face', badge: '2' })
    expect(look({ pendingCount: 0, roomy: true }).shape).toBe('face')
  })

  it('悬停那句：开头随形状 / 开合换，未读只在没有待确认时说', () => {
    // 只验拼法（哪几段、什么顺序），字用占位，真文案按键从词典取的那条由走查 D5 量。
    const labels = { open: 'OPEN', collapse: 'COLLAPSE', pending: (n: number) => `PENDING-${n}`, status: 'STATUS', unread: (n: number) => `UNREAD-${n}` }
    expect(nomiEntryTooltip(look({ unreadCount: 3 }), { pendingCount: 0, unreadCount: 3, open: false }, labels)).toBe('OPEN · STATUS · UNREAD-3')
    expect(nomiEntryTooltip(look({ pendingCount: 2 }), { pendingCount: 2, unreadCount: 5, open: false }, labels)).toBe('PENDING-2 · STATUS')
    expect(nomiEntryTooltip(look({ pendingCount: 2, open: true }), { pendingCount: 2, unreadCount: 0, open: true }, labels)).toBe('COLLAPSE · STATUS')
    expect(nomiEntryTooltip(look({ pendingCount: 2, roomy: false }), { pendingCount: 2, unreadCount: 0, open: false }, labels)).toBe('OPEN · STATUS')
  })

  it('G1：快捷键前缀 Mac ⌘、Windows Ctrl+', () => {
    expect(nomiEntryShortcutPrefix('MacIntel')).toBe('⌘')
    expect(nomiEntryShortcutPrefix('Win32')).toBe('Ctrl+')
    expect(nomiEntryShortcutPrefix('Linux x86_64')).toBe('Ctrl+')
  })
})

describe('入口不跟鼠标（★7：没有整窗 pointermove 监听）', () => {
  it('入口相关文件里没有 pointermove / mousemove 监听', () => {
    for (const file of ['nomiEntryLook.ts', 'ShellNomiEntry.tsx']) {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
      expect(source, file).not.toMatch(/addEventListener\(\s*['"](pointermove|mousemove)['"]/)
    }
    expect(fs.existsSync(path.join(__dirname, 'useAgentBallEyeFollow.ts'))).toBe(false)
  })
})

// I1「没有球」的结构判据（对照表 I1、设计卡 ★9 第一行）：走查里量 `[data-agent-ball]` = 0 是空话——锚点删掉以后它永远是 0，
// check:walkthroughs 的「锚点已无人渲染」门岗也不许那样写。这里量源码：主分支上 AgentBallFace.tsx 还在、还渲染 data-agent-ball，红；
// 删干净才绿。别的形状的浮动叫回按钮由走查的「被压住的格子」按每个可点控件查（I1 后半）。
describe('没有球（I1 结构判据）', () => {
  const srcRoot = path.resolve(__dirname, '../../..')
  const walkSrc = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walkSrc(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
  const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('src 生产代码里没有人渲染 data-agent-ball，小球组件文件不在', () => {
    const renderers = walkSrc(srcRoot)
      .filter((file) => stripComments(fs.readFileSync(file, 'utf8')).includes('data-agent-ball'))
      .map((file) => path.relative(srcRoot, file).split(path.sep).join('/'))
    expect(renderers).toEqual([])
    expect(fs.existsSync(path.join(__dirname, 'AgentBallFace.tsx'))).toBe(false)
  })
})
