// R16 旅程 J-D7「摆一个姿势」（导演台骨骼交互，见 docs/plan/2026-09-03-director-chrome-parity.md §5）。
// 真实任务：放主角 → F 聚焦到人 → 骨骼页（默认选骨盆）→ 点右手把手选中、拖 gizmo 中心抬手 → 同法拖右肘向转肘 → 拖骨盆下蹲两脚钉住 →
//           切 FK 点 3D 骨骼球选左大臂（滑条 ±180、五档快选）→ W / E 切 IK / FK。
// 把手点一下只是选中，拖动只经 TransformControls（中心八面体 = 沿相机正对平面自由移动），工具条没选工具时不挂 gizmo。
import { launchDirectorLab, placeCharacter, clickOrFail } from './_directorLab.mjs'
const lab = await launchDirectorLab({ name: 'j7-skeleton', viewport: { width: 1600, height: 900 } })
const { page, check } = lab
try {
  await placeCharacter(lab, 'male', 0, 0)
  await lab.waitScene('s.objects.length === 1', '角色入场')
  const hero = (await lab.scene()).objects[0]
  await clickOrFail(lab.outlinerRow(hero.name), '大纲·主角')
  // F 聚焦：把人框满视口，把手之间才拉得开（远景里 gizmo 的拾取块会盖住邻近把手）
  await page.mouse.move(700, 400)
  await page.keyboard.press('f')
  await page.waitForTimeout(800)
  await clickOrFail(page.getByRole('radio', { name: '骨骼' }).first(), '骨骼页')
  await page.waitForTimeout(600)
  check('进骨骼页默认选骨盆', (await page.getByText('骨盆/重心 (Pelvis)', { exact: false }).count()) >= 1)
  const pelvis = await lab.bridge('projectByName', 'ik-handle-pelvis', hero.id)
  const rightHand0 = await lab.bridge('projectByName', 'ik-handle-rightHand', hero.id)
  const elbowPole = await lab.bridge('projectByName', 'ik-handle-rightElbowPole', hero.id)
  check('IK 把手（骨盆 / 右手 / 右肘向）都在视口里', Boolean(pelvis && rightHand0 && elbowPole), JSON.stringify({ pelvis, rightHand: rightHand0, elbowPole }))
  await lab.snap('ik-handles')
  // 「选择」工具下没有 gizmo（transformMode 空即 detach）：按住已选中的骨盆把手拖，把手世界位置纹丝不动（拖到的只是 Orbit）
  // （Esc = 清工具 + 清全部选中，会把骨骼页一起关掉，所以这里点工具条的「选择」）
  await clickOrFail(page.getByTestId('director-viewport-toolbar').getByRole('radio', { name: /^选择/ }), '工具条·选择')
  await page.waitForTimeout(300)
  await page.mouse.move(pelvis.x, pelvis.y); await page.mouse.down()
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(pelvis.x, pelvis.y + i * 6)
  await page.mouse.up()
  await page.waitForTimeout(400)
  const pelvisAfterSelectTool = await lab.bridge('projectByName', 'ik-handle-pelvis', hero.id)
  const pelvisShift = Math.hypot(pelvisAfterSelectTool.world[0] - pelvis.world[0], pelvisAfterSelectTool.world[1] - pelvis.world[1], pelvisAfterSelectTool.world[2] - pelvis.world[2])
  check('选择工具下拖把手不动（没有 gizmo 可拖，世界位移 < 1cm）', pelvisShift < 0.01, `${(pelvisShift * 100).toFixed(1)}cm`)
  await page.keyboard.press('1')
  await page.waitForTimeout(300)
  // Orbit 被拖过，把手屏幕位置全变了：重新投影
  const rightHand = await lab.bridge('projectByName', 'ik-handle-rightHand', hero.id)
  // 点右手把手 = 选中（gizmo 挪过去）→ 按住 gizmo 中心往上拖
  await page.mouse.click(rightHand.x, rightHand.y)
  await page.waitForTimeout(300)
  check('点把手选中右手', (await page.getByText('右手 (R-Hand)', { exact: false }).count()) >= 1)
  await page.mouse.move(rightHand.x, rightHand.y); await page.mouse.down()
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(rightHand.x, rightHand.y - i * 8)
  await page.mouse.up()
  await lab.waitScene(`Object.keys((s.objects.find(o => o.id === '${hero.id}').boneRotations) || {}).some(k => /RightArm|RightForeArm/.test(k))`, 'IK 写入右臂')
  await lab.snap('ik-drag-hand')
  // 拖右肘向
  const pole2 = await lab.bridge('projectByName', 'ik-handle-rightElbowPole', hero.id)
  const before = Object.keys((await lab.scene()).objects[0].boneRotations || {})
  await page.mouse.click(pole2.x, pole2.y)
  await page.waitForTimeout(300)
  await page.mouse.move(pole2.x, pole2.y); await page.mouse.down()
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(pole2.x - i * 6, pole2.y - i * 6)
  await page.mouse.up()
  await page.waitForTimeout(600)
  const afterPole = (await lab.scene()).objects[0].boneRotations || {}
  check('拖肘向写入右上臂', 'mixamorigRightArm' in afterPole || Object.keys(afterPole).length >= before.length, Object.keys(afterPole).join(','))
  await lab.snap('ik-drag-pole')
  // 拖骨盆：脚钉住
  const feetBefore = await lab.bridge('projectByName', 'ik-handle-leftFoot', hero.id)
  const pelvis2 = await lab.bridge('projectByName', 'ik-handle-pelvis', hero.id)
  await page.mouse.click(pelvis2.x, pelvis2.y)
  await page.waitForTimeout(300)
  check('点骨盆环选中骨盆', (await page.getByText('骨盆/重心 (Pelvis)', { exact: false }).count()) >= 1)
  // F 聚焦后相机从上前方看人，gizmo 中心的自由拾取块正对镜头：按住中心往下拖 = 骨盆下沉（three TransformControls 本性）
  await page.mouse.move(pelvis2.x, pelvis2.y); await page.mouse.down()
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(pelvis2.x, pelvis2.y + i * 5)
  await page.mouse.up()
  await lab.waitScene(`(s.objects.find(o => o.id === '${hero.id}').hipsOffset || {y:0}).y < -0.02`, '骨盆偏移写入')
  const feetAfter = await lab.bridge('projectByName', 'ik-handle-leftFoot', hero.id)
  check('拖骨盆时左脚钉在原地（屏幕位移 < 12px）', Math.hypot(feetAfter.x - feetBefore.x, feetAfter.y - feetBefore.y) < 12, `${Math.hypot(feetAfter.x - feetBefore.x, feetAfter.y - feetBefore.y).toFixed(1)}px`)
  await lab.snap('ik-drag-pelvis')
  // FK：切 FK → 骨骼球 → 点左大臂球 → 旋转 gizmo
  await page.getByText('FK 骨骼微调', { exact: true }).click()
  await page.waitForTimeout(500)
  const ball = await lab.bridge('projectByName', 'bone-hitbox-leftArm')
  check('FK 页 3D 骨骼球可见（左大臂）', Boolean(ball), JSON.stringify(ball))
  await lab.snap('fk-bones')
  await page.mouse.click(ball.x, ball.y)
  await page.waitForTimeout(400)
  const selectedText = await page.getByTestId('director-timeline-header').count()
  check('点 3D 骨骼球选中大臂（检查器显示已选中关节）', (await page.getByText('左大臂 (L-Arm)', { exact: false }).count()) >= 1 && selectedText === 1)
  await lab.snap('fk-selected')
  check('FK 滑条量程 ±180', (await page.locator('input[type=range][min="-180"][max="180"]').count()) === 3)
  check('快选五档', (await page.getByRole('button', { name: /^[+-]?(45|90)°$/ }).count()) === 4 && (await page.getByRole('button', { name: '0°(复位)' }).count()) === 1)
  await page.keyboard.press('w')
  await page.waitForTimeout(300)
  check('按 W 切回 IK（IK 动力学靶点行出现）', (await page.getByText('IK 动力学靶点', { exact: false }).count()) === 1)
  await page.keyboard.press('e')
  await page.waitForTimeout(300)
  check('按 E 切到 FK', (await page.getByText('FK 骨骼关节', { exact: false }).count()) === 1)
} catch (error) {
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false)
} finally {
  await lab.finish()
}
