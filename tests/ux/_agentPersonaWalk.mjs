// Agent 形象走查（2026-10-27 拍板 docs/design/boards/2026-10-27-agent-persona/AgentPersona.board.json）。
// 形象从内容区右下的小球搬到顶栏最右那颗 Nomi 入口（NomiEntryTopbar 板，设计卡 docs/plan/2026-11-22-nomi-entry-topbar.md ★1b）；
// 由 shell-redesign.walk.mjs 在画布页、Nomi 收着时调用。
//
// 做三件事：
//   ① 五副长相 + 未读点逐格量（真计算样式 / 盒子）并裁图，交给人逐项对样张 preview/；等你确认是整颗入口长成的胶囊，不再是脸变形；
//   ② 脸只是装饰：脸上任一点命中的仍是那颗原生按钮，读屏 / 悬停那一句由按钮自己说（打开说明 · 状态 · 未读条数）；
//   ③ 动效纪律：空闲时入口上没有一直在跑的动画（眨眼除外）；减弱动效下形变硬切、不眨不跳，在跑那段弧静止留着。
// 小球的 44px 尺寸、眼睛跟鼠标、拖动 / 右键菜单随小球一起删（AgentPersona 板 persona.size / persona.eyes / ball.behaviors 改 dropped）。
// 显示态与 shell-redesign 一样由 E2E 桥写进入口读的角标投影（不跑真 Agent）；真实待确认数据走 agent-form-switch-state。
import { expect, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { NOMI_ENTRY } from './_shell.mjs'

/** 1 个形象单位（入口里的脸是 26px 舞台 / 28）。 */
const U = 26 / 28

/** 入口此刻的长相事实：盒子、圆角、底色、眼睛、弧、点、胶囊、命中、动画。 */
function readFace(win) {
  return win.evaluate((selector) => {
    const entry = document.querySelector(selector)
    if (!entry) return null
    const face = entry.querySelector('[data-nomi-agent-face]')
    const body = entry.querySelector('[data-nomi-agent-body]')
    const eyes = [...entry.querySelectorAll('[data-nomi-agent-eye]')]
    const smiles = [...entry.querySelectorAll('[data-nomi-agent-smile]')]
    const ring = entry.querySelector('[data-nomi-entry-progress]')
    const capsule = entry.querySelector('[data-nomi-entry-capsule]')
    const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, right: b.right, bottom: b.bottom } }
    const probe = document.createElement('span')
    probe.style.background = 'var(--nomi-logo-ground)'
    document.body.appendChild(probe)
    const logoGround = getComputedStyle(probe).backgroundColor
    probe.remove()
    const style = body ? getComputedStyle(body) : null
    const own = getComputedStyle(entry)
    const hitAt = (el) => {
      const b = el.getBoundingClientRect()
      return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === entry
    }
    const names = (el) => el.getAnimations({ subtree: true }).map((animation) => animation.animationName ?? animation.transitionProperty ?? 'unknown')
    return {
      pose: face?.getAttribute('data-nomi-agent-face') ?? null,
      faceHidden: face ? face.closest('[aria-hidden="true"]') !== null : null,
      shape: entry.getAttribute('data-shape'),
      entry: box(entry),
      entryRadius: Number.parseFloat(own.borderTopLeftRadius),
      entryBg: own.backgroundColor,
      body: body ? box(body) : null,
      bodyRadius: style ? Number.parseFloat(style.borderTopLeftRadius) : null,
      bodyBg: style?.backgroundColor ?? null,
      bodyTransform: style?.transform ?? null,
      bodyDuration: style?.transitionDuration ?? null,
      bodyTransitionProperty: style?.transitionProperty ?? null,
      bodyEase: style?.transitionTimingFunction ?? null,
      bodyShadow: style?.boxShadow ?? '',
      ariaLabel: entry.getAttribute('aria-label') ?? '',
      logoGround,
      eyes: eyes.map((eye) => ({ ...box(eye), ownHeight: Number.parseFloat(getComputedStyle(eye).height), opacity: Number(getComputedStyle(eye).opacity), bg: getComputedStyle(eye).backgroundColor })),
      smiles: smiles.map((smile) => Number(getComputedStyle(smile).opacity)),
      ring: ring ? { ...box(ring), animations: ring.getAnimations().length, topColor: getComputedStyle(ring).borderTopColor } : null,
      unreadDot: Boolean(entry.querySelector('[data-nomi-entry-dot="unread"]')),
      dangerDot: Boolean(entry.querySelector('[data-nomi-entry-dot="failed"]')),
      badge: entry.querySelector('[data-nomi-entry-badge]')?.textContent ?? null,
      capsuleText: capsule?.textContent ?? '',
      // 字被截：内容宽超过框宽（英文「Confirm 2」）。
      capsuleClipped: capsule ? capsule.scrollWidth > capsule.clientWidth + 0.5 : false,
      hits: [body, ...eyes, ...smiles, ring].filter(Boolean).every(hitAt),
      animations: names(entry),
    }
  }, NOMI_ENTRY)
}

const near = (actual, wanted, slack, message) => expect(Math.abs(actual - wanted), `${message}（实测 ${actual?.toFixed?.(2)}，应约 ${wanted.toFixed(2)}）`).toBeLessThanOrEqual(slack)

/**
 * @param {import('playwright').Page} win
 * @param {{ locale: string, zh: boolean, scheme: 'light'|'dark', shotPath: (name: string) => string, setBadge: (status: string|null, pending: number, unread?: number) => Promise<unknown>, onShot?: (file: string) => void }} options
 */
export async function walkAgentPersona(win, { locale, zh, scheme, shotPath, setBadge, onShot = () => {} }) {
  const measures = {}
  const entry = win.locator(NOMI_ENTRY)
  const crop = async (name) => {
    const b = await entry.boundingBox()
    if (!b) throw new Error(`裁 ${name} 时顶栏 Nomi 入口不在`)
    const pad = 20
    const file = shotPath(name)
    // 右缘对齐入口：胶囊往左长，左边留到 180px 好让胶囊整颗进图。
    await screenshotSettled(win, { path: file, clip: { x: Math.max(0, b.x + b.width - 180 - pad), y: Math.max(0, b.y - pad), width: 180 + pad * 2, height: b.height + pad * 2 } })
    onShot(file)
    return file
  }
  const settle = () => win.waitForTimeout(900) // 形变 550ms + 轻跳 700ms 的大头，截图再由 screenshotSettled 等安定
  const pose = async (status, pending, unread, wantedPose, assertion) => {
    await setBadge(status, pending, unread)
    await expect(entry.locator(`[data-nomi-agent-face="${wantedPose}"]`), `入口没换成「${wantedPose}」的长相 · ${assertion}`).toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
    await settle()
    const facts = await readFace(win)
    expect(facts.faceHidden, `脸不是装饰（读屏会读到） · ${assertion}`).toBe(true)
    expect(facts.hits, `脸上某一块挡住了按钮的命中（装饰必须不吃指针） · board:AgentPersona/persona.body`).toBe(true)
    return facts
  }

  await win.mouse.move(8, 400)

  // ── ① 五副长相 + 未读 ──
  const idle = await pose('idle', 0, 0, 'idle', 'board:AgentPersona/state.idle')
  near(idle.body.w, 22 * U, 1, '空闲的形边长不对 · board:AgentPersona/persona.body')
  near(idle.bodyRadius / idle.body.w, 0.25, 0.02, '空闲的形圆角不是边长 25%（与 logo mark 同一比例） · board:AgentPersona/persona.body')
  expect(idle.bodyBg, '形不是 logo 底色 token（--nomi-logo-ground） · board:AgentPersona/persona.body').toBe(idle.logoGround)
  expect(idle.eyes.filter((eye) => eye.opacity > 0.9), '空闲时不是两只睁开的眼 · board:AgentPersona/persona.body').toHaveLength(2)
  // 眼睛比例（拍板：宽 15%、高 30%、上沿距顶 30%，左沿在 28% / 56%，都按身体边长算）。
  near(idle.eyes[0].w / idle.body.w, 0.155, 0.02, '眼睛宽不是身体的 15% · board:AgentPersona/persona.body')
  near(idle.eyes[0].h / idle.body.h, 0.30, 0.02, '眼睛高不是身体的 30% · board:AgentPersona/persona.body')
  near((idle.eyes[0].y - idle.body.y) / idle.body.h, 0.30, 0.02, '眼睛上沿不在 30% · board:AgentPersona/persona.body')
  near((idle.eyes[0].x - idle.body.x) / idle.body.w, 0.28, 0.02, '左眼左沿不在 28% · board:AgentPersona/persona.body')
  near((idle.eyes[1].x - idle.body.x) / idle.body.w, 0.56, 0.02, '右眼左沿不在 56% · board:AgentPersona/persona.body')
  // 暗色模式：身体一圈 1px 浅描边（白 14%）以免被深色外壳吃掉；浅色模式那圈是白 30%，压在浅色外壳上看不出（NomiEntryTopbar 板浅色不画），走 token。
  const ringColor = /((?:rgba?|oklch|oklab|color)\([^()]*\)) 0px 0px 0px 1px/.exec(idle.bodyShadow)?.[1] ?? ''
  const ringAlpha = Number((/\/\s*([\d.]+)\)$/.exec(ringColor) ?? /,\s*([\d.]+)\)$/.exec(ringColor))?.[1] ?? Number.NaN)
  near(ringAlpha, scheme === 'dark' ? 0.14 : 0.3, 0.02, `身体没有那圈浅描边（box-shadow：${idle.bodyShadow}） · board:AgentPersona/persona.on-dark`)
  near(idle.eyes[0].h, 6.6 * U, 0.8, '空闲眼睛高度不对 · board:AgentPersona/state.idle')
  expect(idle.ring, '空闲时还挂着在跑的弧 · board:AgentPersona/state.idle').toBeNull()
  expect(idle.unreadDot || idle.dangerDot, '空闲时冒了点 · board:AgentPersona/state.idle').toBe(false)
  expect(idle.ariaLabel, '悬停 / 读屏那句丢了状态 · board:AgentPersona/persona.tooltip').toContain(uiText(locale, 'agentPanelV4.dockIdle'))
  expect(idle.bodyDuration, '形变没走 morph token（550ms） · board:AgentPersona/motion.morph-token').toContain('0.55s')
  expect(idle.bodyEase, '形变缓动不是 morph token · board:AgentPersona/motion.morph-token').toContain('cubic-bezier(0.16, 1, 0.3, 1)')
  // 空闲时没有一直在跑的动画（眨眼是定时器加一次、眨完摘，可能恰好撞上，只放过它）。
  expect(idle.animations.filter((name) => name !== 'nomi-agent-blink'), '空闲时入口上还有动画在跑 · board:AgentPersona/state.idle').toEqual([])
  await crop('persona-idle')
  measures.idle = idle

  const running = await pose('running', 0, 0, 'running', 'board:AgentPersona/state.running')
  near(running.bodyRadius, running.body.w / 2, 0.8, '在跑时没变圆 · board:AgentPersona/state.running')
  expect(running.ring, '在跑时没有 accent 弧（data-nomi-entry-progress） · board:AgentPersona/state.running').not.toBeNull()
  expect(running.ring.animations, '在跑的弧没在转 · board:AgentPersona/state.running').toBeGreaterThan(0)
  expect(running.animations, '在跑时眼睛没扫 · board:AgentPersona/state.running').toContain('nomi-agent-scan')
  expect(running.ariaLabel, '在跑的悬停 / 读屏那句不对 · board:AgentPersona/persona.tooltip').toContain(uiText(locale, 'agentPanelV4.dockRunning'))
  await crop('persona-running')
  measures.running = running

  // 等你确认：顶栏够宽、面板收着时整颗入口长成 warning 胶囊「等你确认 N」（NomiEntryTopbar 板 B1），右缘不动往左长；不叠点。
  const pillLabel = uiTextWith(locale, 'appShell.agent.entryPending', { count: 2 })
  await setBadge('needs-confirm', 2, 0)
  await expect(win.locator(`${NOMI_ENTRY}[data-shape="capsule"]`), '等你确认 2 时入口没长成胶囊 · board:AgentPersona/state.needs-confirm').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await settle()
  const confirm = await readFace(win)
  expect(confirm.capsuleText, '胶囊里写的不是「等你确认 N」 · board:AgentPersona/state.needs-confirm').toBe(pillLabel)
  expect(confirm.capsuleClipped, `胶囊里的字被截了（${locale}） · board:AgentPersona/state.needs-confirm`).toBe(false)
  near(confirm.entry.h, 28, 0.5, '胶囊高度不是顶栏钮的 28 · board:AgentPersona/state.needs-confirm')
  expect(confirm.entryRadius, '胶囊不是全圆角 · board:AgentPersona/state.needs-confirm').toBeGreaterThanOrEqual(confirm.entry.h / 2 - 0.5)
  expect(confirm.entry.w, '胶囊没有长出来 · board:AgentPersona/state.needs-confirm').toBeGreaterThan(idle.entry.w)
  near(confirm.entry.right, idle.entry.right, 1, '胶囊右缘没贴着原来那颗入口（应右缘不动往左长） · board:AgentPersona/state.needs-confirm')
  expect(confirm.entryBg, '胶囊不是 warning 浅底 · board:AgentPersona/state.needs-confirm').not.toBe(idle.entryBg)
  expect(confirm.unreadDot || confirm.dangerDot, '胶囊上还叠了点 · board:AgentPersona/state.needs-confirm').toBe(false)
  expect(confirm.ariaLabel, '胶囊的悬停 / 读屏那句不对 · board:AgentPersona/persona.tooltip').toContain(pillLabel)
  await crop('persona-confirm')
  measures.confirm = confirm

  const done = await pose('done', 0, 0, 'done', 'board:AgentPersona/state.done')
  expect(done.eyes.every((eye) => eye.opacity < 0.1), '刚做完时圆眼没收起 · board:AgentPersona/state.done').toBe(true)
  expect(done.smiles.filter((opacity) => opacity > 0.9), '刚做完时没眯眼笑 · board:AgentPersona/state.done').toHaveLength(2)
  near(done.body.w, 24 * U, 1, '刚做完的形宽不对 · board:AgentPersona/state.done')
  near(done.body.h, 18 * U, 1, '刚做完的形高不对 · board:AgentPersona/state.done')
  expect(done.ariaLabel, '刚做完的悬停 / 读屏那句不对 · board:AgentPersona/persona.tooltip').toContain(uiText(locale, 'agentPanelV4.dockDone'))
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
  await crop('persona-failed')
  measures.failed = failed

  const unread = await pose('idle', 0, 3, 'unread', 'board:AgentPersona/variant.unread')
  expect(unread.unreadDot, '有未读却没冒点 · board:AgentPersona/variant.unread').toBe(true)
  expect(unread.eyes[0].y, '有未读时眼睛没往屏幕里看（抬一点） · board:AgentPersona/variant.unread').toBeLessThan(idle.eyes[0].y)
  expect(unread.eyes[0].x, '有未读时眼睛没往屏幕里看（往左一点） · board:AgentPersona/variant.unread').toBeLessThan(idle.eyes[0].x)
  expect(unread.ariaLabel, '悬停 / 读屏那句没说有几条新消息 · board:AgentPersona/variant.unread').toMatch(zh ? /3 条新消息/ : /New messages: 3/)
  await crop('persona-unread')
  const runningUnread = await pose('running', 0, 1, 'running', 'board:AgentPersona/variant.unread')
  expect(runningUnread.unreadDot, '在跑时来了新动静却没挂点（照 10-08 规则在跑照样挂） · board:AgentPersona/variant.unread').toBe(true)
  await crop('persona-running-unread')
  measures.unread = unread

  // ── ② 减弱动效 ──
  await win.emulateMedia({ reducedMotion: 'reduce' })
  try {
    const reducedRunning = await pose('running', 0, 0, 'running', 'board:AgentPersona/state.running')
    expect(reducedRunning.ring, '减弱动效时在跑那段弧不见了（应静止留着） · board:AgentPersona/state.running').not.toBeNull()
    expect(reducedRunning.ring.animations, '减弱动效时弧还在转 · board:AgentPersona/state.running').toBe(0)
    expect(reducedRunning.animations, '减弱动效时入口上还有动画 · board:AgentPersona/motion.morph-token').toEqual([])
    // 硬切 = 没有过渡：要么不过渡任何属性（transition-property: none），要么时长全是 0。
    const hardCut = reducedRunning.bodyTransitionProperty === 'none' || /^0s(, 0s)*$/.test(reducedRunning.bodyDuration ?? '')
    expect(hardCut, `减弱动效时形变不是硬切（transition-property ${reducedRunning.bodyTransitionProperty} / duration ${reducedRunning.bodyDuration}） · board:AgentPersona/motion.morph-token`).toBe(true)
    await crop('persona-reduced-running')
    const reducedDone = await pose('done', 0, 0, 'done', 'board:AgentPersona/state.done')
    expect(reducedDone.animations, '减弱动效时刚做完还在跳 · board:AgentPersona/state.done').toEqual([])
    measures.reduced = { running: reducedRunning, done: reducedDone }
  } finally {
    await win.emulateMedia({ reducedMotion: null })
    await setBadge('idle', 0, 0)
  }
  return measures
}
