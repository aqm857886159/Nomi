// 10×10 群众（施工计划 docs/plan/2026-10-07-director-ual-mannequin.md §9 真实任务 ③）：
// 放一个人 → 时间轴给他加「走路」片段 → 精修「＋ → 角色 → 群众」10 行 × 10 列 → 点地面放下 → 101 个 UAL 人偶 → 量群众站的不是 T 字 → 播放 3 秒量帧间隔 → 截图。
// （3D-BOX 起群众不再是选中角色后检查器基础页的「批量生成群众队列」，入口是添加菜单里的「群众」：设行列间距 → 放置群众 → 点地面。）
// 无界面 Chromium 是软件渲染（SwiftShader）：帧间隔只当相对参考，真 GPU 帧率另记 unverified。
// 用法：node tests/ux/director-ual-crowd.walk.mjs（先开着 `vite --port 5175` 走热路径）
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { addTrack, clickOrFail, expectVisible, launchDirectorLab, openAddMenu, placeCharacter, rowAddClipMenu } from './_directorLab.mjs'
import { stationTimeout } from './_station-budget.mjs'

const lab = await launchDirectorLab({ name: 'ual-crowd', viewport: { width: 1600, height: 900 }, shotsDir: makeTempDir('nomi-director-crowd-') })
const { page, check } = lab
const header = () => page.getByTestId('director-timeline-header')
/** 从头播放 3 秒，量 rAF 帧间隔，再停止回 0 帧 */
async function measurePlayback(label, clickOptions) {
  await clickOrFail(header().getByRole('button', { name: /^停止/ }), '停止回开头', clickOptions)
  await clickOrFail(header().getByRole('button', { name: /^播放/ }), '播放', clickOptions)
  const stats = await page.evaluate(() => new Promise((resolve) => {
    const gaps = []
    let last = performance.now()
    const start = last
    const tick = (now) => {
      gaps.push(now - last)
      last = now
      if (now - start < 3000) requestAnimationFrame(tick)
      else {
        gaps.sort((a, b) => a - b)
        resolve({ frames: gaps.length, medianMs: Math.round(gaps[Math.floor(gaps.length / 2)]), p90Ms: Math.round(gaps[Math.floor(gaps.length * 0.9)]) })
      }
    }
    requestAnimationFrame(tick)
  }))
  console.log(`  · ${label} 播放中帧间隔（无界面软件渲染，相对参考）：${JSON.stringify(stats)}`)
  await clickOrFail(header().getByRole('button', { name: /^停止/ }), '停止回开头', clickOptions)
  return stats
}
try {
  await placeCharacter(lab, 'male', 0, 0)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 1", '主角落地')
  const hero = (await lab.scene()).objects[0]
  await addTrack(lab, hero.name)
  await rowAddClipMenu(lab, hero.name, '内置动作片段')
  const modal = page.getByRole('dialog').filter({ hasText: '选择动作片段' })
  await expectVisible(modal, '动作库弹窗没打开')
  await modal.getByRole('option', { name: /^走路/ }).first().dblclick()
  await lab.waitScene(`(s.objects.find(o => o.id === '${hero.id}').actionClips || []).some(c => c.actionPose === 'Walk_Loop')`, '走路片段入轨')
  const single = await measurePlayback('1 人')
  // 刚加的片段是选中态：Esc 清掉，再从精修「＋ → 角色 → 群众」设 10 行 × 10 列、间距 1.2 m，放置群众后点主角身后的地面
  await page.mouse.move(800, 300)
  await page.keyboard.press('Escape')
  await openAddMenu(lab, '角色')
  await clickOrFail(page.getByTestId('director-add-crowd'), '角色下拉·群众')
  const place = page.getByTestId('director-crowd-place')
  await expectVisible(place, '群众设置没展开')
  const crowdPanel = place.locator('xpath=..')
  for (const [label, value] of [['行数', '10'], ['列数', '10'], ['间距', '1.2']]) {
    const field = crowdPanel.locator('label').filter({ has: page.getByText(label, { exact: true }) }).locator('input[type="text"]')
    await field.fill(value)
    await field.press('Enter')
  }
  await clickOrFail(place, '群众设置·放置群众')
  const spot = await lab.bridge('projectPoint', 0, 0, -3)
  await page.mouse.click(spot.x, spot.y)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 101", '10×10 群众生成', stationTimeout({ operations: 8 }))
  await page.waitForFunction(() => {
    const bridge = window.__nomiDirectorE2E
    return bridge && bridge.findAll('characterMount').length >= 101
  }, null, { timeout: stationTimeout({ operations: 16 }) })
  check('101 个人偶都挂上了', (await lab.bridge('findAll', 'characterMount')).length >= 101)
  // 群众姿势不是绑定姿态（2026-10-24 走查 ①）：群众默认动作曾是别名 standing_idle，姿态采样只认动作库正名、查不到就退回绑定姿态，
  // 100 个人站成 T 字（以前只断言「挂上了 / 帧在走」，拦不住）。量手和上臂根部的世界高度：T 字两手平举、和上臂一样高；
  // 站立待机两手垂下，比上臂低一大截——和群众朝哪边无关。动作数据（UAL 一个 glb）随主角的走路片段已经载好，等它 ready 再量。
  await page.waitForFunction(() => window.__nomiDirectorE2E?.poseClipStatus('Idle_Loop') === 'ready', null, { timeout: stationTimeout({ operations: 4 }) })
  await page.waitForTimeout(500)
  const crowdMembers = (await lab.scene()).objects.filter((object) => object.type === 'character' && object.parentId)
  const sampled = [crowdMembers[0], crowdMembers[Math.floor(crowdMembers.length / 2)], crowdMembers[crowdMembers.length - 1]]
  const handDrops = []
  for (const member of sampled) {
    const hand = await lab.bridge('projectByName', 'DEF-handL', member.id)
    const upperArm = await lab.bridge('projectByName', 'DEF-upper_armL', member.id)
    handDrops.push(hand && upperArm ? Number((upperArm.world[1] - hand.world[1]).toFixed(2)) : null)
  }
  check('群众姿势不是绑定姿态（左手比上臂根部低 0.25 m 以上；T 字两手平举、高度差约 0）', handDrops.every((drop) => drop !== null && drop > 0.25),
    `posePreset=${crowdMembers[0]?.posePreset} · 手比上臂低（m）=${JSON.stringify(handDrops)}`)
  // 群众真站好以后每人每帧都要套一次站立姿态（T 字时采样落空、什么都不套）：101 个蒙皮人偶 + 阴影在无界面软件渲染下播放一帧约 0.8 s，
  // 截图要等一帧合成，单步 15 s 的上限在机器忙时会撞上（本机 2 次里撞过 1 次）。这一段的单步上限放到 4 个操作，仍只是上限、不是等待条件。
  const crowdClick = { timeout: stationTimeout({ operations: 4 }) }
  page.setDefaultTimeout(crowdClick.timeout)
  // 视角拉远看全体：Esc 清选择后按 F（无选中 = 框全部）
  await page.mouse.move(800, 300)
  await page.keyboard.press('Escape')
  await page.keyboard.press('f')
  await page.waitForTimeout(1500)
  await lab.snap('crowd-static')
  await clickOrFail(header().getByRole('button', { name: /^播放/ }), '播放（截播放中的样子）', crowdClick)
  await page.waitForTimeout(2500)
  await lab.snap('crowd-playing')
  const many = await measurePlayback('101 人', crowdClick)
  check('播放中有帧在走', many.frames > 1, JSON.stringify(many))
  console.log(`  · 101 人 / 1 人 帧间隔比：${(many.medianMs / Math.max(1, single.medianMs)).toFixed(1)}×`)
} catch (error) {
  check(`旅程中断：${String(error.stack ?? error)}`, false)
  await lab.snap('journey-failed')
} finally {
  await lab.finish()
}
