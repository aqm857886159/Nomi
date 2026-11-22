import { describe, expect, it } from 'vitest'
import { dockStatusLabel, resolveDockStatus, resolveDockStatuses, type V4DockLabels } from './agentPanelV4DockStatus'

const facts = (over: Partial<Parameters<typeof resolveDockStatus>[0]> = {}) => ({
  running: false,
  pendingCount: 0,
  failed: false,
  justFinished: false,
  ...over,
})

describe('⑦ 收起坞 · logo 上叠的那一格', () => {
  it('什么都没发生时不叠东西——「没事」最好的表达是不说话', () => {
    expect(resolveDockStatus(facts())).toBe('idle')
  })

  it('有回合活着 = 运行中', () => {
    expect(resolveDockStatus(facts({ running: true }))).toBe('running')
  })

  it('有介入槽在等时**压过**运行中：卡着的那件事才是用户能改变的', () => {
    expect(resolveDockStatus(facts({ running: true, pendingCount: 2 }))).toBe('needs-confirm')
  })

  it('待确认压过失败：失败已经发生完了，提问还没有', () => {
    expect(resolveDockStatus(facts({ failed: true, pendingCount: 1 }))).toBe('needs-confirm')
  })

  it('失败压过运行中——重试往往正跑着，但用户要看的是坏掉的那条', () => {
    expect(resolveDockStatus(facts({ failed: true, running: true }))).toBe('failed')
  })

  it('刚跑完的那几秒是勾号，之后掉回空闲', () => {
    expect(resolveDockStatus(facts({ justFinished: true }))).toBe('done')
    expect(resolveDockStatus(facts({ justFinished: false }))).toBe('idle')
  })

  it('还在跑的时候不提前报完成', () => {
    expect(resolveDockStatus(facts({ running: true, justFinished: true }))).toBe('running')
  })
})

describe('顶栏入口 · 合并状态和脸的状态一次求出（NomiEntryTopbar 板 B5 / B6）', () => {
  it('在做 + 待确认 2：合并状态是等你确认，脸照样在做（弧在转，待确认交给角标 / 胶囊）', () => {
    expect(resolveDockStatuses(facts({ running: true, pendingCount: 2 }))).toEqual({ status: 'needs-confirm', faceStatus: 'running' })
  })

  it('只有待确认：合并状态照优先级是等你确认，脸不看待确认、是空闲', () => {
    expect(resolveDockStatuses(facts({ pendingCount: 1 }))).toEqual({ status: 'needs-confirm', faceStatus: 'idle' })
  })

  it('没成 + 待确认 1：合并状态等你确认，脸是没成（红点由入口长相按待确认另判）', () => {
    expect(resolveDockStatuses(facts({ failed: true, pendingCount: 1 }))).toEqual({ status: 'needs-confirm', faceStatus: 'failed' })
  })

  it('没有待确认时两份一样：脸和合并状态不分家', () => {
    for (const over of [{}, { running: true }, { failed: true }, { justFinished: true }, { failed: true, running: true }]) {
      const both = resolveDockStatuses(facts(over))
      expect(both.faceStatus).toBe(both.status)
      expect(both.status).toBe(resolveDockStatus(facts(over)))
    }
  })
})

describe('⑦ 收起坞 · hover 那一行字', () => {
  const labels: V4DockLabels = {
    open: '展开 Nomi',
    idle: '空闲',
    running: '正在做',
    needsConfirm: (count) => `等你确认 ${count} 条`,
    done: '刚做完',
    failed: '出错了',
  }

  it('待确认那句带**真实条数**，不是一个写死的「有待确认」', () => {
    expect(dockStatusLabel('needs-confirm', 3, labels)).toBe('等你确认 3 条')
  })

  it('其余四档各说各的话', () => {
    expect(dockStatusLabel('idle', 0, labels)).toBe('空闲')
    expect(dockStatusLabel('running', 0, labels)).toBe('正在做')
    expect(dockStatusLabel('done', 0, labels)).toBe('刚做完')
    expect(dockStatusLabel('failed', 0, labels)).toBe('出错了')
  })
})
