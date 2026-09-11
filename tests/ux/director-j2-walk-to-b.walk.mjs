// R16 旅程 J-D2「让角色 A 走到 B 身边」（导演台 V2，方案 §7 S2 验收）。
// 真实任务：放 A、B 两个角色 → 选 A → 顶栏「画线」(4) → 在地面从 A 拖到 B → 时间轴出路径片段 → Space 播放 → A 真的到了 B 身边。
// 证据：路径片段落盘（有路标、时长按弧长 / 1.4m/s）、播放后 A 的世界包围盒中心贴近 B、时间轴轨道出现、截图。
// 用法：node tests/ux/director-j2-walk-to-b.walk.mjs
import { expectHidden } from './_assert.mjs'
import { clickOrFail, dragGround, expectVisible, launchDirectorLab, placeCharacter } from './_directorLab.mjs'
import { stationTimeout } from './_station-budget.mjs'

const lab = await launchDirectorLab({ name: 'j2-walk-to-b' })
const { page, check } = lab

try {
  await placeCharacter(lab, 'female', -3, 0)
  await placeCharacter(lab, 'male', 3, 0)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 2", '两个角色落地')
  const [a, b] = (await lab.scene()).objects.filter((object) => object.type === 'character')

  await clickOrFail(lab.outlinerRow(a.name), '大纲·A')
  await page.mouse.move(700, 300)
  await page.keyboard.press('4')
  await expectVisible(page.getByText(/画线|手绘/).first(), '没进入画线模式（HUD 没有提示条）')
  await lab.snap('pencil-mode')

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
