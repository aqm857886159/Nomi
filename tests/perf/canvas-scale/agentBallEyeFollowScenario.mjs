// 「Agent 小球眼睛跟着鼠标看」场景（设计卡 docs/plan/2026-10-27-agent-persona.md ★7；卡顿场景表
// tests/perf/scenarios/agent-ball-eye-follow.json）。和 pan-while-agent-streaming 同一套起法：本机假模型慢慢吐长正文
// （零花费、零外网），Agent 在跑时把面板收成小球，鼠标在小球 160px 以内来回扫——这是跟随最忙的时候：
// 每一帧都有指针事件、小球在转弧、画布上挂着最坏规模的节点。
//
// 量四件事：
//   · 帧间隔 / 长任务：同一个帧探针（ctx.startWindow / stopWindow）；
//   · 跟随引起的重渲染：小球按钮宿主 fiber 与 AgentBallFace（forwardRef）fiber 的 memoizedProps / memoizedState 身份，
//     每帧比一次，变一次记一次（React 每渲染一次都会换成新对象，所以 0 次变化 ⇔ 0 次渲染）；先量一段鼠标不动的对照；
//   · 跟随真的在工作：小球按钮 style 属性被写了几次（只写 --nomi-agent-look-x / -y 两个变量）；
//   · 空闲没有持续的帧：回合跑完、小球落回空闲、鼠标不动 2 秒里，整页请求了几次 requestAnimationFrame、
//     小球上挂着几条动画（约 20 秒一次的眨眼除外）。
import { ensureAgentPanelOpen } from '../../ux/_shell.mjs'

const PANEL = '[data-agent-resident="true"][data-agent-panel="true"][data-agent-surface="generation"]'
const BALL = '[data-agent-ball]'
const FOLLOW_STEPS = 120
const STILL_MS = 1200
const IDLE_MS = 2000

/** 带进样本的数（canvas-scale-bench 的 SCENARIO_SAMPLE_KEYS）。 */
export const AGENT_BALL_SAMPLE_KEYS = ['ballRendersDuringFollow', 'ballRendersStill', 'lookWrites', 'followMoves', 'idleRafRequests', 'idleBallAnimations', 'idleRafCallers']

/**
 * 结构预算（硬断言，不看机器快慢）：跟随那一段小球零渲染、空闲 2 秒整页零动画帧请求、小球上除眨眼外零动画。
 * 任一样本违反就让基准非 0 退出（统一跑法判红），和远看密集的结构预算同一个口子。
 */
export function agentBallStructureViolations(sample) {
  const over = []
  if (sample.ballRendersDuringFollow !== 0) over.push(`跟随时小球重渲染 ${sample.ballRendersDuringFollow} 次（应为 0）`)
  if (sample.idleRafRequests !== 0) over.push(`空闲 2 秒里整页请求了 ${sample.idleRafRequests} 次动画帧（应为 0）`)
  if (sample.idleBallAnimations !== 0) over.push(`空闲时小球上还挂着 ${sample.idleBallAnimations} 条动画（眨眼除外，应为 0）`)
  return over
}

const sleep = (page, ms) => page.waitForTimeout(ms)

function installBallProbe(page) {
  return page.evaluate((selector) => {
    const ball = document.querySelector(selector)
    if (!ball) return { error: '小球不在' }
    const key = Object.keys(ball).find((name) => name.startsWith('__reactFiber$'))
    const host = key ? ball[key] : null
    let owner = host?.return ?? null
    while (owner && owner.tag !== 11) owner = owner.return // 11 = ForwardRef（AgentBallFace）
    if (!host || !owner) return { error: '找不到小球的 React fiber' }
    const identities = () => [host, host.alternate, owner, owner.alternate].filter(Boolean).flatMap((fiber) => [fiber.memoizedProps, fiber.memoizedState])
    const state = { last: identities(), renders: 0, raf: 0, styleWrites: 0, running: false }
    const tick = () => {
      const now = identities()
      if (now.length !== state.last.length || now.some((value, index) => value !== state.last[index])) state.renders += 1
      state.last = now
      if (state.running) state.raf = requestAnimationFrame(tick)
    }
    const observer = new MutationObserver((records) => { state.styleWrites += records.length })
    window.__nomiBallProbe = {
      start() {
        state.last = identities()
        state.renders = 0
        state.styleWrites = 0
        state.running = true
        observer.observe(ball, { attributes: true, attributeFilter: ['style'] })
        state.raf = requestAnimationFrame(tick)
      },
      stop() {
        state.running = false
        cancelAnimationFrame(state.raf)
        tick()
        observer.disconnect()
        return { renders: state.renders, styleWrites: state.styleWrites }
      },
    }
    return { ok: true }
  }, BALL)
}

/** 鼠标在小球左上方 60–140px 的扇面里来回扫（小球贴着右下角，往右下扫就出窗口了）。 */
async function sweepNearBall(page, centre, steps) {
  for (let index = 1; index <= steps; index += 1) {
    const angle = Math.PI + (Math.PI / 2) * (0.5 - 0.5 * Math.cos((index / steps) * Math.PI * 4))
    const radius = 100 + 40 * Math.sin((index / steps) * Math.PI * 6)
    await page.mouse.move(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius, { steps: 1 })
    await sleep(page, 14)
  }
}

export async function agentBallEyeFollow(page, ctx) {
  await page.keyboard.press('Escape')
  await ensureAgentPanelOpen(page)
  const input = page.locator(`${PANEL} [data-v4-control="input"]`).first()
  const assistantSelector = `${PANEL} [data-v4-block="assistant"]`
  // 上一次采样的回答块还在：等这一轮新长出来、已经有字的那一块。
  const before = await page.locator(assistantSelector).count()
  await input.click()
  await input.fill(`perf eye follow ${ctx.runIndex}: describe the next shot`)
  await page.locator(`${PANEL} [data-v4-control="send"]`).first().click()
  await page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length > count && (document.querySelectorAll(selector)[count].textContent?.length ?? 0) > 0, { selector: assistantSelector, count: before }, { timeout: 30_000 })
  // 收成小球：Agent 还在吐字，小球应是「在跑」。
  await page.locator(`${PANEL} [data-agent-form-to="ball"]`).first().click()
  await page.locator(`${BALL}[data-agent-ball="running"]`).waitFor({ timeout: 10_000 })
  const box = await page.locator(BALL).boundingBox()
  if (!box) return { skipped: '收起后小球不在' }
  const centre = { x: box.x + box.width - 22, y: box.y + box.height / 2 }
  const probe = await installBallProbe(page)
  if (probe.error) return { skipped: probe.error }

  // 对照：鼠标停在远处不动，量同样长的一段里小球渲染了几次（流式本身会不会让小球重渲染）。
  await page.mouse.move(centre.x - 400, centre.y - 300)
  await sleep(page, 300)
  await page.evaluate(() => window.__nomiBallProbe.start())
  await sleep(page, STILL_MS)
  const still = await page.evaluate(() => window.__nomiBallProbe.stop())

  // 被测那一段：鼠标在小球 160px 内来回扫。
  await page.mouse.move(centre.x - 120, centre.y - 20)
  await page.evaluate(() => window.__nomiBallProbe.start())
  await ctx.startWindow(page)
  await sweepNearBall(page, centre, FOLLOW_STEPS)
  const raw = await ctx.stopWindow(page)
  const follow = await page.evaluate(() => window.__nomiBallProbe.stop())
  const runningAtEnd = (await page.locator(`${BALL}[data-agent-ball="running"]`).count()) > 0

  // 空闲：回合跑完 → 刚做完（2.4 秒）→ 空闲；鼠标挪远、不动，量 2 秒。
  await page.mouse.move(centre.x - 400, centre.y - 300)
  await page.locator(`${BALL}[data-agent-ball="idle"]`).waitFor({ timeout: 60_000 })
  await sleep(page, 800)
  const idle = await page.evaluate(async ({ selector, ms }) => {
    const real = window.requestAnimationFrame
    let requests = 0
    const callers = new Set()
    window.requestAnimationFrame = function counted(callback) {
      requests += 1
      // 万一不是 0：记下是谁在要帧（前几条调用栈的第二帧），好在报告里点名，不用猜。
      if (callers.size < 4) callers.add(String(new Error().stack ?? '').split('\n')[2]?.trim() ?? '?')
      return real.call(window, callback)
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, ms))
    } finally {
      window.requestAnimationFrame = real
    }
    const ball = document.querySelector(selector)
    const animations = ball ? ball.getAnimations({ subtree: true }).filter((animation) => animation.animationName !== 'nomi-agent-blink').length : null
    return { requests, callers: [...callers], animations, look: ball?.style.getPropertyValue('--nomi-agent-look-x') ?? null }
  }, { selector: BALL, ms: IDLE_MS })

  if (!runningAtEnd) return { skipped: '扫的那一段结束时 Agent 已经不在跑了，不是「在跑时跟随」' }
  if (follow.styleWrites === 0) return { skipped: '扫的那一段里眼睛一次都没动（跟随没在工作）' }
  return {
    raw,
    ballRendersDuringFollow: follow.renders,
    ballRendersStill: still.renders,
    lookWrites: follow.styleWrites,
    followMoves: FOLLOW_STEPS,
    idleRafRequests: idle.requests,
    idleBallAnimations: idle.animations,
    idleSeconds: IDLE_MS / 1000,
    idleRafCallers: idle.callers,
    path: 'agent ball eye follow while streaming (collapsed ball, pointer sweeping within 160px)',
  }
}
