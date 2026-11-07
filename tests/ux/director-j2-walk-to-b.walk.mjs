// R16 旅程 J-D2「让角色 A 走到 B 身边」（导演台 V2，方案 §7 S2 验收）。
// 真实任务：放 A、B 两个角色 → 选 A → 「画线」(4，按钮住属性卡头) → 在地面从 A 拖到 B → 时间轴出路径片段 → Space 播放 → A 真的到了 B 身边。
// 证据：路径片段落盘（有路标、时长按弧长 / 1.4m/s）、播放后 A 的世界包围盒中心贴近 B、时间轴轨道出现、截图。
// 用法：node tests/ux/director-j2-walk-to-b.walk.mjs
import { expectHidden } from './_assert.mjs'
import { clickOrFail, dragGround, expectVisible, launchDirectorLab, placeCharacter } from './_directorLab.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { MIN_WINDOW } from './_minWindow.mjs'

const lab = await launchDirectorLab({ name: 'j2-walk-to-b' })
const { page, check } = lab

try {
  await placeCharacter(lab, 'female', -3, 0)
  await placeCharacter(lab, 'male', 3, 0)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 2", '两个角色落地')
  const [a, b] = (await lab.scene()).objects.filter((object) => object.type === 'character')

  await lab.pickInOutliner(a.name, '大纲·A')
  await page.mouse.move(700, 300)
  await page.keyboard.press('4')
  await expectVisible(page.getByTestId('director-viewport-hud').filter({ hasText: /画线|手绘/ }), '没进入画线模式（HUD 没有提示条）')
  await lab.snap('pencil-mode')

  // ⑥（2026-10-24）：提示条以前写死 top-3，正好压在顶栏正中的「导演 | 精修」底下；画线的钮住在属性卡头，画线时卡一定开着，
  // 窄窗里居中的提示条还会钻到卡底下。走查默认窗口（1440）和 App 最小窗口（electron/mainWindowMinSize.json；窗宽 < 1060 时 Agent 收成小球，不再让出右侧）各量一次：两样都不许相交。
  const hudOverlaps = () => page.evaluate(() => {
    const rect = (testId) => document.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect() ?? null
    const meet = (a, b) => Boolean(a && b) && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const hud = rect('director-viewport-hud')
    const viewSwitch = rect('director-view-mode')
    const card = rect('director-context-card')
    return { width: window.innerWidth, ok: Boolean(hud && viewSwitch && card), overSwitch: meet(hud, viewSwitch), overCard: meet(hud, card), hud, viewSwitch, card }
  })
  const wide = await hudOverlaps()
  check('画线提示条不压在「导演 | 精修」切换上', wide.ok && !wide.overSwitch, JSON.stringify(wide))
  check('画线提示条不钻到属性卡底下', wide.ok && !wide.overCard, JSON.stringify(wide))
  const fullSize = page.viewportSize()
  await page.setViewportSize({ width: MIN_WINDOW.width, height: MIN_WINDOW.height })
  await page.waitForFunction((width) => window.innerWidth === width, MIN_WINDOW.width)
  const narrow = await hudOverlaps()
  check(`App 最小窗口（${MIN_WINDOW.width}×${MIN_WINDOW.height}）里提示条照样不压切换、不钻到属性卡底下`, narrow.ok && !narrow.overSwitch && !narrow.overCard, JSON.stringify(narrow))
  await lab.snap('pencil-mode-narrow')
  await page.setViewportSize(fullSize)
  await page.waitForFunction((size) => window.innerWidth === size.width && window.innerHeight === size.height, fullSize)
  // 三维画布在下一帧才按新尺寸改相机比例：等两帧再按投影点去拖，免得落点偏
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  // 从 A 脚下拖到 B 身边（留 0.8m 停在身边而不是撞上）
  await dragGround(lab, [a.position.x + 0.3, a.position.z], [b.position.x - 0.8, b.position.z], 24)
  await lab.waitScene(`(s.objects.find(o => o.id === '${a.id}').trajectoryClips || []).length === 1`, 'A 有路径片段')
  const walked = (await lab.scene()).objects.find((object) => object.id === a.id)
  const clip = walked.trajectoryClips[0]
  const points = walked.motionTrajectory || []
  const seconds = clip.endTime - clip.startTime
  check('路径片段带路标（≥ 3 个）', points.length >= 3, `${points.length} 路标`)
  check('时长按弧长 / 1.4m/s（约 4–5s）', seconds > 2.5 && seconds < 7, `${seconds.toFixed(2)}s`)
  await expectVisible(lab.trackRow(a.name), '时间轴没出现 A 的轨道')
  await expectHidden(page.getByTestId('director-timeline-empty'), '有轨道了时间轴空态还在')
  check('时间轴空态消失', true)
  await lab.snap('path-drawn')

  // 播放到内容末：A 的包围盒中心应贴近 B
  const before = await lab.bridge('boundsByEntity', a.id)
  await page.keyboard.press('Escape')
  await page.mouse.move(700, 300)
  await page.keyboard.press(' ')
  await page.waitForFunction(
    ({ id, targetX }) => {
      const bridge = window.__nomiDirectorE2E
      const box = bridge && bridge.boundsByEntity(id)
      return Boolean(box) && (box.min[0] + box.max[0]) / 2 > targetX
    },
    { id: a.id, targetX: b.position.x - 1.6 },
    { timeout: stationTimeout({ operations: 2 }) },
  )
  const after = await lab.bridge('boundsByEntity', a.id)
  const centerBefore = (before.min[0] + before.max[0]) / 2
  const centerAfter = (after.min[0] + after.max[0]) / 2
  check('A 从 -3 走到 B 身边', centerAfter - centerBefore > 4 && centerAfter < b.position.x, `x ${centerBefore.toFixed(2)} → ${centerAfter.toFixed(2)}（B 在 ${b.position.x}）`)
  await lab.snap('arrived')
  // 静止数据没被播放污染：rest 位置仍在原地
  check('播放不改静止位置', Math.abs((await lab.scene()).objects.find((o) => o.id === a.id).position.x - a.position.x) < 1e-6)
} catch (error) {
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false)
} finally {
  await lab.finish()
}
