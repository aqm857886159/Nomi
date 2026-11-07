// Agent 形象走查（2026-10-27 拍板 docs/design/boards/2026-10-27-agent-persona/AgentPersona.board.json；
// 设计卡 docs/plan/2026-10-27-agent-persona.md ★9）。由 shell-redesign.walk.mjs 在画布页小球在场时调用。
//
// 做三件事：
//   ① 五副长相 + 未读点逐格量（真计算样式 / 盒子）并裁图，交给人逐项对样张 preview/；
//   ② 证「只换脸，不换行为」：脸上任一点命中的仍是那颗原生按钮、Tab 焦点描边画在可见的形上、拖动落盘且
//      松手不弹面板（老 bug，设计卡「实现时的取舍」第 16 条）、小于 4px 的拖 = 点击（开面板、焦点进输入框）、
//      右键出形态菜单、悬停名字照旧；
//   ③ 动效纪律：空闲时小球上没有一直在跑的动画；眼睛跟随只写 CSS 变量、离远归位；减弱动效下形变硬切、
//      不跟不眨不跳，在跑那段弧静止留着。
// 显示态与 shell-redesign 一样由 E2E 桥写进小球读的角标投影（不跑真 Agent）；真实待确认数据走 agent-form-switch-state。
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'

const BALL = '[data-agent-ball]'
/** 1 个形象单位（44px 舞台 / 28）。 */
const U = 44 / 28

/** 小球此刻的长相事实：盒子、圆角、底色、眼睛、弧、点、命中、动画。 */
function readFace(win) {
  return win.evaluate((selector) => {
    const ball = document.querySelector(selector)
    if (!ball) return null
    const face = ball.querySelector('[data-nomi-agent-face]')
    const body = ball.querySelector('[data-nomi-agent-body]')
    const eyes = [...ball.querySelectorAll('[data-nomi-agent-eye]')]
    const smiles = [...ball.querySelectorAll('[data-nomi-agent-smile]')]
    const ring = ball.querySelector('[data-agent-ball-progress]')
    const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, right: b.right, bottom: b.bottom } }
    const probe = document.createElement('span')
    probe.style.background = 'var(--nomi-logo-ground)'
    document.body.appendChild(probe)
    const logoGround = getComputedStyle(probe).backgroundColor
    probe.remove()
    const style = body ? getComputedStyle(body) : null
    const hitAt = (el) => {
      const b = el.getBoundingClientRect()
      return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === ball
    }
    const names = (el) => el.getAnimations({ subtree: true }).map((animation) => animation.animationName ?? animation.transitionProperty ?? 'unknown')
    return {
      pose: face?.getAttribute('data-nomi-agent-face') ?? null,
      faceHidden: face?.getAttribute('aria-hidden') === 'true',
      ball: box(ball),
      body: body ? box(body) : null,
      bodyRadius: style ? Number.parseFloat(style.borderTopLeftRadius) : null,
      bodyBg: style?.backgroundColor ?? null,
      bodyTransform: style?.transform ?? null,
      bodyDuration: style?.transitionDuration ?? null,
      bodyTransitionProperty: style?.transitionProperty ?? null,
      bodyEase: style?.transitionTimingFunction ?? null,
      bodyOutline: style?.outlineStyle ?? null,
      bodyShadow: style?.boxShadow ?? '',
      ariaLabel: ball.getAttribute('aria-label') ?? '',
      logoGround,
      eyes: eyes.map((eye) => ({ ...box(eye), ownHeight: Number.parseFloat(getComputedStyle(eye).height), opacity: Number(getComputedStyle(eye).opacity), bg: getComputedStyle(eye).backgroundColor })),
      smiles: smiles.map((smile) => Number(getComputedStyle(smile).opacity)),
      ring: ring ? { ...box(ring), animations: ring.getAnimations().length, topColor: getComputedStyle(ring).borderTopColor } : null,
      unreadDot: Boolean(ball.querySelector('[data-dot-mark]')),
      dangerDot: Boolean(ball.querySelector('.bg-nomi-danger')),
      pillText: ball.querySelector('[data-nomi-agent-label]')?.textContent ?? '',
      // 字被截：内容宽超过框宽（英文「Needs you 2」最长）。
      pillClipped: (() => { const label = ball.querySelector('[data-nomi-agent-label]'); return label ? label.scrollWidth > label.clientWidth + 0.5 : false })(),
      title: ball.getAttribute('title') ?? '',
      hits: [body, ...eyes, ...smiles, ring].filter(Boolean).every(hitAt),
      animations: names(ball),
      lookX: ball.style.getPropertyValue('--nomi-agent-look-x'),
      lookY: ball.style.getPropertyValue('--nomi-agent-look-y'),
      focused: document.activeElement === ball,
      // 按钮自己（透明点击框）的描边：焦点描边只许画在身体上，按钮这一圈必须看不见（否则是两道焦点圈）。
      ballOutline: (() => { const s = getComputedStyle(ball); return { style: s.outlineStyle, color: s.outlineColor, width: s.outlineWidth, shadow: s.boxShadow, matchesFocusVisible: ball.matches(':focus-visible'), className: ball.className } })(),
    }
  }, BALL)
}

const near = (actual, wanted, slack, message) => expect(Math.abs(actual - wanted), `${message}（实测 ${actual?.toFixed?.(2)}，应约 ${wanted.toFixed(2)}）`).toBeLessThanOrEqual(slack)

/**
 * @param {import('playwright').Page} win
 * @param {{ locale: string, zh: boolean, scheme: 'light'|'dark', shotPath: (name: string) => string, setBadge: (status: string|null, pending: number, unread?: number) => Promise<unknown>, onShot?: (file: string) => void }} options
 */
export async function walkAgentPersona(win, { locale, zh, scheme, shotPath, setBadge, onShot = () => {} }) {
  const measures = {}
  const ball = win.locator(BALL)
  const crop = async (name) => {
    const b = await ball.boundingBox()
    if (!b) throw new Error(`裁 ${name} 时小球不在`)
    const pad = 20
    const file = shotPath(name)
    // 右缘、下缘对齐小球：胶囊往左长，左边留到 180px 好让胶囊整颗进图。
    await screenshotSettled(win, { path: file, clip: { x: Math.max(0, b.x + b.width - 180 - pad), y: Math.max(0, b.y - pad), width: 180 + pad * 2, height: b.height + pad * 2 } })
    onShot(file)
    return file
  }
  const settle = () => win.waitForTimeout(900) // 形变 550ms + 轻跳 700ms 的大头，截图再由 screenshotSettled 等安定
  const pose = async (status, pending, unread, wantedPose, assertion) => {
    await setBadge(status, pending, unread)
    await expect(ball.locator(`[data-nomi-agent-face="${wantedPose}"]`), `小球没换成「${wantedPose}」的长相 · ${assertion}`).toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
    await settle()
    const facts = await readFace(win)
    expect(facts.faceHidden, `脸不是装饰（读屏会读到） · ${assertion}`).toBe(true)
    expect(facts.hits, `脸上某一块挡住了按钮的命中（装饰必须不吃指针） · board:AgentPersona/ball.behaviors`).toBe(true)
    return facts
  }

  await win.mouse.move(8, 8)

  // ── ① 五副长相 + 未读 ──
  const idle = await pose('idle', 0, 0, 'idle', 'board:AgentPersona/state.idle')
  near(idle.ball.w, 44, 0.5, '小球不是 44px · board:AgentPersona/persona.size')
  near(idle.ball.h, 44, 0.5, '小球不是 44px 高 · board:AgentPersona/persona.size')
  near(idle.body.w, 22 * U, 1, '空闲的形边长不对 · board:AgentPersona/persona.body')
  near(idle.bodyRadius / idle.body.w, 0.25, 0.02, '空闲的形圆角不是边长 25%（与 logo mark 同一比例） · board:AgentPersona/persona.body')
  expect(idle.bodyBg, '形不是 logo 底色 token（--nomi-logo-ground） · board:AgentPersona/persona.body').toBe(idle.logoGround)
  expect(idle.eyes.filter((eye) => eye.opacity > 0.9), '空闲时不是两只睁开的眼 · board:AgentPersona/persona.eyes').toHaveLength(2)
  // 眼睛比例（拍板：宽 15%、高 30%、上沿距顶 30%，左沿在 28% / 56%，都按身体边长算）。
  near(idle.eyes[0].w / idle.body.w, 0.155, 0.02, '眼睛宽不是身体的 15% · board:AgentPersona/persona.eyes')
  near(idle.eyes[0].h / idle.body.h, 0.30, 0.02, '眼睛高不是身体的 30% · board:AgentPersona/persona.eyes')
  near((idle.eyes[0].y - idle.body.y) / idle.body.h, 0.30, 0.02, '眼睛上沿不在 30% · board:AgentPersona/persona.eyes')
  near((idle.eyes[0].x - idle.body.x) / idle.body.w, 0.28, 0.02, '左眼左沿不在 28% · board:AgentPersona/persona.eyes')
  near((idle.eyes[1].x - idle.body.x) / idle.body.w, 0.56, 0.02, '右眼左沿不在 56% · board:AgentPersona/persona.eyes')
  // 压在深色画面上 / 暗色模式：身体一圈 1px 浅描边（白 30% / 暗色 14%），走 token。
  const ringColor = /((?:rgba?|oklch|oklab|color)\([^()]*\)) 0px 0px 0px 1px/.exec(idle.bodyShadow)?.[1] ?? ''
  const ringAlpha = Number((/\/\s*([\d.]+)\)$/.exec(ringColor) ?? /,\s*([\d.]+)\)$/.exec(ringColor))?.[1] ?? Number.NaN)
  near(ringAlpha, scheme === 'dark' ? 0.14 : 0.3, 0.02, `身体没有那圈浅描边（box-shadow：${idle.bodyShadow}） · board:AgentPersona/persona.on-dark`)
  near(idle.eyes[0].h, 6.6 * U, 0.8, '空闲眼睛高度不对 · board:AgentPersona/state.idle')
  expect(idle.ring, '空闲时还挂着在跑的弧 · board:AgentPersona/state.idle').toBeNull()
  expect(idle.unreadDot || idle.dangerDot, '空闲时冒了点 · board:AgentPersona/state.idle').toBe(false)
  expect(idle.title, '悬停名字丢了（照旧用现有 title） · board:AgentPersona/persona.tooltip').toContain(uiText(locale, 'agentPanelV4.dockIdle'))
  expect(idle.bodyDuration, '形变没走 morph token（550ms） · board:AgentPersona/motion.morph-token').toContain('0.55s')
  expect(idle.bodyEase, '形变缓动不是 morph token · board:AgentPersona/motion.morph-token').toContain('cubic-bezier(0.16, 1, 0.3, 1)')
  // 空闲时没有一直在跑的动画（眨眼是定时器加一次、眨完摘，可能恰好撞上，只放过它）。
  expect(idle.animations.filter((name) => name !== 'nomi-agent-blink'), '空闲时小球上还有动画在跑 · board:AgentPersona/state.idle').toEqual([])
  await crop('persona-idle')
  measures.idle = idle

  const running = await pose('running', 0, 0, 'running', 'board:AgentPersona/state.running')
  near(running.bodyRadius, running.body.w / 2, 0.8, '在跑时没变圆 · board:AgentPersona/state.running')
  expect(running.ring, '在跑时没有 accent 弧（data-agent-ball-progress） · board:AgentPersona/state.running').not.toBeNull()
  expect(running.ring.animations, '在跑的弧没在转 · board:AgentPersona/state.running').toBeGreaterThan(0)
  expect(running.animations, '在跑时眼睛没扫 · board:AgentPersona/state.running').toContain('nomi-agent-scan')
  expect(running.title, '在跑的悬停名字不对 · board:AgentPersona/persona.tooltip').toContain(uiText(locale, 'agentPanelV4.dockRunning'))
  await crop('persona-running')
  measures.running = running

  const pillLabel = uiTextWith(locale, 'appShell.agent.ballPending', { count: 2 })
  const confirm = await pose('needs-confirm', 2, 0, 'confirm', 'board:AgentPersona/state.needs-confirm')
  expect(confirm.pillText, '胶囊里写的不是「等你确认 N」 · board:AgentPersona/state.needs-confirm').toBe(pillLabel)
  expect(confirm.pillClipped, `胶囊里的字被截了（${locale}） · board:AgentPersona/state.needs-confirm`).toBe(false)
  near(confirm.body.h, 11 * U + 18, 1, '胶囊高度不对 · board:AgentPersona/state.needs-confirm')
  near(confirm.bodyRadius, confirm.body.h / 2, 0.8, '胶囊不是全圆角 · board:AgentPersona/state.needs-confirm')
  expect(confirm.body.w, '胶囊超过 132px · board:AgentPersona/persona.size').toBeLessThanOrEqual(132)
  expect(confirm.body.w, '胶囊没有长出来 · board:AgentPersona/state.needs-confirm').toBeGreaterThan(44)
  near(confirm.ball.right - confirm.body.right, U, 1, '胶囊右缘没贴着原来那颗球（应右缘不动往左长） · board:AgentPersona/persona.size')
  near(confirm.ball.w, 132, 0.5, '胶囊的点击区域缩了（按钮应仍是 132 宽） · board:AgentPersona/persona.size')
  expect(confirm.eyes.every((eye) => eye.bg !== idle.eyes[0].bg), '胶囊里的眼睛不是 warning 深色 · board:AgentPersona/state.needs-confirm').toBe(true)
  expect(confirm.title, '胶囊的悬停名字不对 · board:AgentPersona/persona.tooltip').toContain(pillLabel)
  await crop('persona-confirm')
  measures.confirm = confirm

  const done = await pose('done', 0, 0, 'done', 'board:AgentPersona/state.done')
  expect(done.eyes.every((eye) => eye.opacity < 0.1), '刚做完时圆眼没收起 · board:AgentPersona/state.done').toBe(true)
  expect(done.smiles.filter((opacity) => opacity > 0.9), '刚做完时没眯眼笑 · board:AgentPersona/state.done').toHaveLength(2)
  near(done.body.w, 24 * U, 1, '刚做完的形宽不对 · board:AgentPersona/state.done')
  near(done.body.h, 18 * U, 1, '刚做完的形高不对 · board:AgentPersona/state.done')
  expect(done.title, '刚做完的悬停名字不对 · board:AgentPersona/persona.tooltip').toContain(uiText(locale, 'agentPanelV4.dockDone'))
  await crop('persona-done')
  measures.done = done

  const failed = await pose('failed', 0, 2, 'failed', 'board:AgentPersona/state.failed')
  expect(failed.bodyTransform, '出错时没歪倒 · board:AgentPersona/state.failed').not.toBe('none')
  const tilt = failed.bodyTransform.match(/matrix\(([^,]+), ([^,]+)/)
  near(Math.atan2(Number(tilt?.[2]), Number(tilt?.[1])) * 180 / Math.PI, -9, 0.5, '出错时歪的角度不对 · board:AgentPersona/state.failed')
  near(failed.eyes[0].ownHeight, 1.7 * U, 0.3, '出错时眼睛没塌成一条 · board:AgentPersona/state.failed')
  expect(failed.dangerDot, '出错时没有 danger 点 · board:AgentPersona/state.failed').toBe(true)
  expect(failed.ariaLabel, '读屏读不出出错 · board:AgentPersona/state.failed').toContain(uiText(locale, 'agentPanelV4.dockFailed'))
  expect(failed.unreadDot, '出错时还叠了未读点（出错点占同一个角） · board:AgentPersona/variant.unread').toBe(false)
  expect(failed.title, '出错的悬停名字不对 · board:AgentPersona/persona.tooltip').toContain(uiText(locale, 'agentPanelV4.dockFailed'))
  await crop('persona-failed')
  measures.failed = failed

  const unread = await pose('idle', 0, 3, 'unread', 'board:AgentPersona/variant.unread')
  expect(unread.unreadDot, '有未读却没冒点 · board:AgentPersona/variant.unread').toBe(true)
  expect(unread.eyes[0].y, '有未读时眼睛没往屏幕里看（抬一点） · board:AgentPersona/variant.unread').toBeLessThan(idle.eyes[0].y)
  expect(unread.eyes[0].x, '有未读时眼睛没往屏幕里看（往左一点） · board:AgentPersona/variant.unread').toBeLessThan(idle.eyes[0].x)
  expect(unread.title, '悬停名字没说有几条新消息 · board:AgentPersona/variant.unread').toMatch(zh ? /3 条新消息/ : /New messages: 3/)
  await crop('persona-unread')
  const runningUnread = await pose('running', 0, 1, 'running', 'board:AgentPersona/variant.unread')
  expect(runningUnread.unreadDot, '在跑时来了新动静却没挂点（照 10-08 规则在跑照样挂） · board:AgentPersona/variant.unread').toBe(true)
  await crop('persona-running-unread')
  measures.unread = unread

  // ── ② 眼睛跟着看 / 悬停抬眼 ──
  await setBadge('idle', 0, 0)
  await settle()
  const at = await ball.boundingBox()
  const centre = { x: at.x + at.width / 2, y: at.y + at.height / 2 }
  await win.mouse.move(centre.x - 100, centre.y - 10, { steps: 4 })
  await expect.poll(async () => Number.parseFloat((await readFace(win)).lookX), { message: '鼠标在左边 100px，眼睛没往左看 · board:AgentPersona/persona.eyes', timeout: stationTimeout() }).toBeLessThan(0)
  await crop('persona-follow')
  await win.mouse.move(centre.x, centre.y, { steps: 2 })
  await expect.poll(async () => Number.parseFloat((await readFace(win)).lookY), { message: '鼠标停在身上没抬眼 · board:AgentPersona/persona.eyes', timeout: stationTimeout() }).toBeLessThan(0)
  await crop('persona-hover')
  await win.mouse.move(centre.x - 400, centre.y - 300, { steps: 3 })
  await expect.poll(async () => (await readFace(win)).lookX, { message: '鼠标离远了眼睛没归位 · board:AgentPersona/persona.eyes', timeout: stationTimeout() }).toBe('')

  // ── ③ 行为一个不少 ──
  // 焦点：键盘 Tab 到小球，描边画在可见的形上（按钮本身透明）。
  await ball.focus()
  await win.keyboard.press('Shift+Tab')
  await win.keyboard.press('Tab')
  await expect.poll(async () => (await readFace(win)).focused, { message: 'Tab 回不到小球 · board:AgentPersona/ball.behaviors', timeout: stationTimeout() }).toBe(true)
  const focusedFace = await readFace(win)
  expect(focusedFace.bodyOutline, '键盘焦点描边没画在可见的形上 · board:AgentPersona/ball.behaviors').toBe('solid')
  const own = focusedFace.ballOutline
  const ownVisible = own.style !== 'none' && !/rgba\(0, 0, 0, 0\)|transparent|\/ 0\)$/.test(own.color)
  expect(ownVisible, `透明点击框自己也画了一道焦点圈（两道焦点圈）：${JSON.stringify(own)} · board:AgentPersona/ball.behaviors`).toBe(false)
  await crop('persona-focus')
  await win.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.blur())

  // 小于 4px 的拖 = 点击：开面板、焦点进输入框。
  await win.mouse.move(centre.x, centre.y)
  await win.mouse.down()
  await win.mouse.move(centre.x + 2, centre.y + 1, { steps: 2 })
  await win.mouse.up()
  await expect(win.locator('[data-agent-float="generation"] [data-v4-panel]'), '点小球（抖 2px）没打开面板 · board:AgentPersona/ball.behaviors').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  // 输入框是 TipTap 可编辑区，不是 textarea：按它的定位口（AGENT_COMPOSER_INPUT_SELECTOR）认；失败时把焦点现场带出来。
  const focusFacts = () => win.evaluate(() => {
    const active = document.activeElement
    return {
      inComposer: Boolean(active?.closest('#project-agent-resident [data-v4-control="input"]')),
      active: active ? `${active.tagName}#${active.id}[${active.getAttribute('data-v4-control') ?? ''}]` : null,
      inputs: document.querySelectorAll('#project-agent-resident [data-v4-control="input"]').length,
    }
  })
  await expect.poll(async () => (await focusFacts()).inComposer, { message: '点开后焦点不在 Agent 输入框 · board:AgentPersona/ball.behaviors', timeout: stationTimeout() })
    .toBe(true)
    .catch(async (error) => { throw new Error(`${error.message}\n焦点现场：${JSON.stringify(await focusFacts())}`) })
  await clickOrFail(win.locator('[data-agent-form-to="ball"]').first(), '浮窗收回小球')
  await expect(ball, '没收回小球').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })

  // 右键：形态菜单（浮窗 / 停靠）照旧。
  await ball.click({ button: 'right' })
  await expect(win.getByRole('menuitem', { name: uiText(locale, 'appShell.agent.toFloat') }), '右键小球没出「浮窗」 · board:AgentPersona/ball.behaviors').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.getByRole('menuitem', { name: uiText(locale, 'appShell.agent.toDock') }), '右键小球没出「停靠」 · board:AgentPersona/ball.behaviors').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await win.keyboard.press('Escape')
  await win.mouse.move(8, 8)

  // ── ④ 减弱动效 ──
  await win.emulateMedia({ reducedMotion: 'reduce' })
  try {
    const reducedRunning = await pose('running', 0, 0, 'running', 'board:AgentPersona/state.running')
    expect(reducedRunning.ring, '减弱动效时在跑那段弧不见了（应静止留着） · board:AgentPersona/state.running').not.toBeNull()
    expect(reducedRunning.ring.animations, '减弱动效时弧还在转 · board:AgentPersona/state.running').toBe(0)
    expect(reducedRunning.animations, '减弱动效时小球上还有动画 · board:AgentPersona/motion.morph-token').toEqual([])
    // 硬切 = 没有过渡：要么不过渡任何属性（transition-property: none），要么时长全是 0。
    const hardCut = reducedRunning.bodyTransitionProperty === 'none' || /^0s(, 0s)*$/.test(reducedRunning.bodyDuration ?? '')
    expect(hardCut, `减弱动效时形变不是硬切（transition-property ${reducedRunning.bodyTransitionProperty} / duration ${reducedRunning.bodyDuration}） · board:AgentPersona/motion.morph-token`).toBe(true)
    await crop('persona-reduced-running')
    const reducedDone = await pose('done', 0, 0, 'done', 'board:AgentPersona/state.done')
    expect(reducedDone.animations, '减弱动效时刚做完还在跳 · board:AgentPersona/state.done').toEqual([])
    await setBadge('idle', 0, 0)
    await settle()
    await win.mouse.move(centre.x - 100, centre.y, { steps: 4 })
    await win.waitForTimeout(300)
    expect((await readFace(win)).lookX, '减弱动效时眼睛还在跟 · board:AgentPersona/persona.eyes').toBe('')
    measures.reduced = { running: reducedRunning, done: reducedDone }
  } finally {
    await win.emulateMedia({ reducedMotion: null })
    await win.mouse.move(8, 8)
  }

  // ── ⑤ 拖动（放最后：拖完要把位置放回去）──
  // 位置落盘（agentFormStore），拖动不算点击、面板不弹开（设计卡 ★9 反例「拖完被当成点击」）。
  await setBadge('idle', 0, 0)
  await settle()
  const before = await win.evaluate(() => window.__nomiAgentFormStore?.getState().bySurface.generation.ball ?? null)
  await win.mouse.move(centre.x, centre.y)
  await win.mouse.down()
  await win.mouse.move(centre.x - 120, centre.y - 60, { steps: 8 })
  await win.mouse.up()
  const dragged = await win.evaluate(() => window.__nomiAgentFormStore?.getState().bySurface.generation.ball ?? null)
  expect(dragged, '拖完小球位置没记下来 · board:AgentPersona/ball.behaviors').not.toBeNull()
  const floatPanel = win.locator('[data-agent-float="generation"] [data-v4-panel]')
  const ballOrPanel = await proveProbe(ball.or(floatPanel).first(), '拖完小球或面板总有一个在（判面板没弹开之前先证探针活着）')
  await expectAbsent(floatPanel, { provenBy: ballOrPanel, message: '拖动被当成了点击，松手后面板弹开了 · board:AgentPersona/ball.behaviors' })
  const moved = await ball.boundingBox()
  near(moved.x, at.x - 120, 2, '小球没跟着拖走 · board:AgentPersona/ball.behaviors')
  await win.evaluate((point) => {
    const store = window.__nomiAgentFormStore
    const state = store?.getState()
    if (state) store.setState({ bySurface: { ...state.bySurface, generation: { ...state.bySurface.generation, ball: point } } })
  }, before)
  await expect.poll(async () => Math.round((await ball.boundingBox()).x), { message: '小球没放回原处', timeout: stationTimeout() }).toBe(Math.round(at.x))
  return measures
}
