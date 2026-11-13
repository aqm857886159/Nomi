// 回合结局判定（classifyTurnOutcome）的离线合同：夹具页面只带面板身份属性与 v4 积木属性，不依赖产品组件。
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { chromium } from 'playwright'
import { CANVAS_PANEL, TURN_OUTCOME, classifyTurnOutcome, isJudgeableOutcome } from './agent-runtime-walk-support.mjs'

let browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 120_000)
afterAll(async () => { await browser?.close() })

const PANEL_OPEN = '<div data-agent-resident="true" data-agent-panel="true" data-agent-surface="generation">'
async function outcomeOf(inner, args = {}) {
  const page = await browser.newPage()
  try {
    await page.setContent(`${PANEL_OPEN}${inner}</div>`)
    return await classifyTurnOutcome(page, { panel: CANVAS_PANEL, ...args })
  } finally { await page.close() }
}

describe('classifyTurnOutcome：只按面板上的真实元素判', () => {
  test('调了工具 -> ran-with-tools', async () => {
    const result = await outcomeOf('<div data-v4-block="assistant">好</div>', { toolCallCount: 2 })
    expect(result.outcome).toBe(TURN_OUTCOME.RAN_WITH_TOOLS)
    expect(isJudgeableOutcome(result.outcome)).toBe(true)
  })
  test('模型只说话、没调工具 -> ran-no-tools（可判）', async () => {
    const result = await outcomeOf('<div data-v4-block="assistant">我来想想</div>')
    expect(result.outcome).toBe(TURN_OUTCOME.RAN_NO_TOOLS)
    expect(isJudgeableOutcome(result.outcome)).toBe(true)
  })
  test('错误带（data-v4-block=errorbar）+ 没工具 -> provider-error（不可判），正文换语言也一样', async () => {
    for (const body of ['Please wait and try again later.', '请稍后再试', 'x']) {
      const result = await outcomeOf(`<div data-v4-block="errorbar">${body}</div>`)
      expect(result.outcome).toBe(TURN_OUTCOME.PROVIDER_ERROR)
      expect(result.errorText).toBe(body)
      expect(isJudgeableOutcome(result.outcome)).toBe(false)
    }
  })
  test('面板级错误带（data-agent-error）同样判 provider-error', async () => {
    const result = await outcomeOf('<div role="alert" data-agent-error="true">连不上</div>')
    expect(result.outcome).toBe(TURN_OUTCOME.PROVIDER_ERROR)
  })
  test('什么都没有、也没见过运行中 -> not-started（不可判）', async () => {
    const result = await outcomeOf('<div data-v4-block="user">hi</div>')
    expect(result.outcome).toBe(TURN_OUTCOME.NOT_STARTED)
    expect(isJudgeableOutcome(result.outcome)).toBe(false)
  })
  test('见过运行中但没有助手消息 -> ran-no-tools（快回合漏采不误判成没起来）', async () => {
    const result = await outcomeOf('', { sawRunning: true })
    expect(result.outcome).toBe(TURN_OUTCOME.RAN_NO_TOOLS)
  })
  test('反例：错误块出现时，绝不能判成正常回合（即使同时有助手消息、见过运行中）', async () => {
    const result = await outcomeOf('<div data-v4-block="assistant">...</div><div data-v4-block="errorbar">取不到</div>', { sawRunning: true })
    expect(result.outcome).not.toBe(TURN_OUTCOME.RAN_NO_TOOLS)
    expect(result.outcome).toBe(TURN_OUTCOME.PROVIDER_ERROR)
  })
  test('别的面板里的错误带不算（只看传入的面板）', async () => {
    const page = await browser.newPage()
    try {
      await page.setContent(`<div data-agent-resident="true" data-agent-panel="true" data-agent-surface="creation"><div data-v4-block="errorbar">别处</div></div>${PANEL_OPEN}<div data-v4-block="assistant">好</div></div>`)
      const result = await classifyTurnOutcome(page, { panel: CANVAS_PANEL })
      expect(result.outcome).toBe(TURN_OUTCOME.RAN_NO_TOOLS)
    } finally { await page.close() }
  })
})
