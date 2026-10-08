// 导演台默认人偶换成 UAL（施工计划 docs/plan/2026-10-07-director-ual-mannequin.md §9 第 2 / 3 刀的真渲染验证）。
// 真实任务：放一个人 → 量身高 / 脚底 → 姿态页切 待机 / 走路 / 坐姿待机 / 说话待机 → 骨骼页 FK 滑条抬左臂、IK 拖右手（只在中文轨）
//           → 时间轴加动作片段：打开动作库弹窗，逐个点 44 个条目截预览，拼成一张动作总览图 → 双击「走路」加片段。
// 用法（先开着 `vite --port 5175` 走热路径，否则自起一个）：
//   node tests/ux/director-ual-mannequin.walk.mjs                  # 中文
//   NOMI_WALK_LOCALE=en node tests/ux/director-ual-mannequin.walk.mjs
// 产出：tests/ux/shots/director/ual-mannequin-<locale>/NN-*.png（gitignore），人眼 Read 过才算数。
import fs from 'node:fs'
import path from 'node:path'
import { clickOrFail, expectVisible, launchDirectorLab, openAddMenu } from './_directorLab.mjs'

const locale = process.env.NOMI_WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const zh = locale === 'zh-CN'
const L = zh
  ? { addTrack: /添加轨道/, addClip: '添加动作 / 骨骼 / 视线片段', character: '角色', male: '男人', pose: '姿态', skeleton: '骨骼', fk: 'FK 骨骼微调', addAction: '内置动作片段', modal: '选择动作片段', walk: '走路',
      poses: [['Idle_Loop', '待机'], ['Walk_Loop', '走路'], ['Sitting_Idle_Loop', '坐姿待机'], ['Idle_Talking_Loop', '说话待机']] }
  : { addTrack: /Add track/, addClip: 'Add action / bone / look-at clip', character: 'Character', male: 'Man', pose: 'Pose', skeleton: 'Skeleton', fk: '', addAction: 'Built-in action clip', modal: 'Select action clip', walk: 'Walk loop',
      poses: [['Idle_Loop', 'Idle loop'], ['Walk_Loop', 'Walk loop'], ['Sitting_Idle_Loop', 'Sitting idle loop'], ['Idle_Talking_Loop', 'Idle talking loop']] }

const lab = await launchDirectorLab({ name: `ual-mannequin-${zh ? 'zh' : 'en'}`, viewport: { width: 1600, height: 900 } })
const { page, check } = lab
try {
  if (!zh) {
    await page.evaluate(() => window.localStorage.setItem('nomi:locale:v1', 'en'))
    await page.reload({ waitUntil: 'commit' })
    await expectVisible(page.getByTestId('director-pip'), 'reload 后导演台没起来')
    await page.waitForFunction(() => Boolean(window.__nomiDirectorE2E))
  }
  await openAddMenu(lab, L.character)
  await clickOrFail(page.getByRole('button', { name: L.male }), `角色下拉·${L.male}`)
  const point = await lab.bridge('projectPoint', 0, 0, 0)
  await page.mouse.click(point.x, point.y)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 1", '角色入场')
  const hero = (await lab.scene()).objects[0]
  check('新加的人 = 默认 UAL 人偶（builtin:ual + rig ual）', hero.modelPath === 'builtin:ual' && hero.rig === 'ual', `${hero.modelPath} / ${hero.rig}`)
  await page.waitForFunction((id) => window.__nomiDirectorE2E?.findAll('characterMount', id).length > 0 && window.__nomiDirectorE2E?.orientationByName('DEF-head', id), hero.id)
  await page.waitForTimeout(800)
  const bounds = await lab.bridge('boundsByName', 'characterMount', hero.id)
  const height = bounds.max[1] - bounds.min[1]
  check('身高 1.75m ±1cm（蒙皮实测）', Math.abs(height - 1.75) < 0.01, `${height.toFixed(3)}m`)
  check('脚底在地面 ±1cm', Math.abs(bounds.min[1]) < 0.01, `min y = ${bounds.min[1].toFixed(3)}`)
  await lab.pickInOutliner(hero.name, '大纲·主角')
  await page.mouse.move(700, 400)
  await page.keyboard.press('f')
  await page.waitForTimeout(800)
  await lab.snap('tpose')

  // 姿态页：四个常用静止姿态，每个截一张；坐姿头要明显变低
  await clickOrFail(page.getByRole('radio', { name: L.pose }).first(), `检查器·${L.pose}`)
  const inspector = page.getByTestId('director-inspector')
  const headY = {}
  for (const [id, label] of L.poses) {
    await clickOrFail(inspector.getByRole('option', { name: label, exact: true }).first(), `姿态·${label}`)
    await lab.waitScene(`s.objects.find(o => o.id === '${hero.id}').posePreset === '${id}'`, `posePreset = ${id}`)
    await page.waitForTimeout(1200)
    headY[id] = (await lab.bridge('orientationByName', 'DEF-head', hero.id)).position[1]
    await lab.snap(`pose-${id}`)
  }
  check('站姿头高 ≈ 1.5m（UAL 头骨根部，缩到 1.75m 后）', headY.Idle_Loop > 1.4 && headY.Idle_Loop < 1.6, headY.Idle_Loop.toFixed(3))
  check('坐姿头比站姿低 ≥ 25cm', headY.Idle_Loop - headY.Sitting_Idle_Loop > 0.25, `${headY.Idle_Loop.toFixed(3)} → ${headY.Sitting_Idle_Loop.toFixed(3)}`)

  if (zh) {
    // 骨骼页 FK：选左大臂球 → 第一条滑条拉到 60°，左手世界位置要动；写进存档的键是 UAL 骨名、值是规范轴度数
    await clickOrFail(inspector.getByRole('option', { name: '待机', exact: true }).first(), '姿态·回待机')
    await clickOrFail(page.getByRole('radio', { name: L.skeleton }).first(), '检查器·骨骼')
    await page.getByText(L.fk, { exact: true }).click()
    await page.waitForTimeout(500)
    const ball = await lab.bridge('projectByName', 'bone-hitbox-leftArm')
    check('FK 骨骼球（左大臂）可点', Boolean(ball), JSON.stringify(ball))
    await page.mouse.click(ball.x, ball.y)
    await page.waitForTimeout(400)
    const handBefore = (await lab.bridge('orientationByName', 'DEF-handL', hero.id)).position
    await page.locator('input[type=range][min="-180"][max="180"]').first().fill('60')
    await lab.waitScene(`(s.objects.find(o => o.id === '${hero.id}').boneRotations || {})['DEF-upper_armL']?.x === 60`, 'FK 写入 DEF-upper_armL.x = 60')
    await page.waitForTimeout(500)
    const handAfter = (await lab.bridge('orientationByName', 'DEF-handL', hero.id)).position
    const moved = Math.hypot(handAfter[0] - handBefore[0], handAfter[1] - handBefore[1], handAfter[2] - handBefore[2])
    check('FK 抬左臂：左手世界位置移动 > 20cm', moved > 0.2, `${moved.toFixed(3)}m`)
    await lab.snap('fk-left-arm-60')
    await page.screenshot({ path: path.join(lab.shotsDir, 'fk-left-arm-60-zoom.png'), clip: { x: 600, y: 0, width: 400, height: 450 } })

    // IK：切 IK、点右手把手、按住往上拖
    await page.keyboard.press('w')
    await page.waitForTimeout(300)
    await page.mouse.move(700, 300)
    await page.keyboard.press('1')
    await page.waitForTimeout(200)
    const rightHand = await lab.bridge('projectByName', 'ik-handle-rightHand', hero.id)
    check('右手 IK 把手投影在视口内', Boolean(rightHand) && rightHand.x > 0 && rightHand.y > 0)
    await page.mouse.click(rightHand.x, rightHand.y)
    await page.waitForTimeout(300)
    await page.mouse.move(rightHand.x, rightHand.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(rightHand.x, rightHand.y - i * 8)
    await page.mouse.up()
    await lab.waitScene(`Object.keys((s.objects.find(o => o.id === '${hero.id}').boneRotations) || {}).some(k => /upper_armR|forearmR/.test(k))`, 'IK 写入右臂（UAL 骨名）')
    await page.waitForTimeout(500)
    const handIk = await lab.bridge('projectByName', 'ik-handle-rightHand', hero.id)
    check('IK 拖完右手把手比拖前高（屏幕上移 > 30px）', rightHand.y - handIk.y > 30, `${(rightHand.y - handIk.y).toFixed(0)}px`)
    await lab.snap('ik-right-hand')
  }

  // 动作库弹窗：44 个条目逐个预览截图，拼一张总览
  // 轨道列头「+ 添加轨道」→ 主角；轨道行「+」→ 内置动作片段（与 _directorLab 的 addTrack / rowAddClipMenu 同一路径，文案按语言取）
  await clickOrFail(page.getByTestId('director-timeline-tracks-header').getByRole('button', { name: L.addTrack }), '轨道列头·添加轨道')
  await clickOrFail(page.getByRole('button', { name: hero.name, exact: true }), `添加轨道·${hero.name}`)
  const row = lab.trackRow(hero.name)
  await expectVisible(row, '时间轴上没有主角轨道')
  await clickOrFail(row.getByRole('button', { name: L.addClip }), '轨道行·添加片段')
  await clickOrFail(page.getByRole('menuitem', { name: L.addAction, exact: true }), `追加片段菜单·${L.addAction}`)
  const modal = page.getByRole('dialog').filter({ hasText: L.modal })
  await expectVisible(modal, '动作库弹窗没打开')
  await page.waitForTimeout(1500)
  await lab.snap('action-modal')
  const options = modal.getByRole('option')
  const count = await options.count()
  check('动作库弹窗列出 44 条（T-Pose + UAL 43 个）', count === 44, String(count))
  const canvas = modal.locator('canvas').first()
  const tiles = []
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index)
    await option.click()
    await page.waitForTimeout(index === 0 ? 1500 : 900)
    const label = (await option.innerText()).split('\n').filter(Boolean)
    const png = await canvas.screenshot()
    tiles.push({ name: label[0] ?? '', kind: label[1] ?? '', data: png.toString('base64') })
  }
  const sheet = await page.context().browser().newPage()
  await sheet.setViewportSize({ width: 1600, height: 900 })
  await sheet.setContent(`<html><body style="margin:0;background:#111;color:#ddd;font:12px sans-serif"><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px;padding:4px">${tiles
    .map((tile) => `<div><img style="width:100%;display:block" src="data:image/png;base64,${tile.data}"><div>${tile.name} · ${tile.kind}</div></div>`)
    .join('')}</div></body></html>`)
  const sheetFile = path.join(lab.shotsDir, 'actions-contact-sheet.png')
  await sheet.screenshot({ path: sheetFile, fullPage: true })
  await sheet.close()
  console.log(`  · shot ${sheetFile}`)
  fs.writeFileSync(path.join(lab.shotsDir, 'actions.json'), JSON.stringify(tiles.map(({ name, kind }) => ({ name, kind })), null, 2))
  await modal.getByRole('option', { name: new RegExp(`^${L.walk}`) }).first().dblclick()
  await lab.waitScene(`(s.objects.find(o => o.id === '${hero.id}').actionClips || []).some(c => c.actionPose === 'Walk_Loop')`, '动作片段 Walk_Loop 入轨')
  await page.waitForTimeout(800)
  await lab.snap('walk-clip-added')
} catch (error) {
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false)
  await lab.snap('journey-failed')
} finally {
  await lab.finish()
}
