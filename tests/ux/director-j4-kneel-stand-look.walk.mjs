// R16 旅程 J-D4「跪下—起身—回头看镜头」（导演台 V2，方案 §7 S4 验收）。
// 真实任务：放主角 + 一台机位 → 主角进时间轴 → 动作轨加「单膝跪地」再加「站立」→ 加视线片段并把目标设成摄像机
//           → 视线有效时段暂停，同帧对照启用前后头的实际侧转 → 继续播放到动作末确认站起
//           → 明确停止回第0帧，再拖右手 IK；全部截图取暂停姿态。
// 证据：真实目标选择、同帧头骨转向增量、末帧骨盆站起高度、IK写入与静止截图。
// 用法：node tests/ux/director-j4-kneel-stand-look.walk.mjs
import { addCameraPreset, addTrack, clickOrFail, expectVisible, launchDirectorLab, placeCharacter, rowAddClipMenu } from './_directorLab.mjs'
import { expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const lab = await launchDirectorLab({ name: 'j4-kneel-stand-look' })
const { page, check } = lab
const timelineHeader = page.getByTestId('director-timeline-header')
const readout = page.getByTestId('director-frame-readout')
const readFrame = async () => Number((await readout.innerText()).match(/^F\s*(\d+)/)?.[1] ?? Number.NaN)
const stopAtStart = async () => {
  await clickOrFail(timelineHeader.getByRole('button', { name: /^停止/ }), '停止并回到开头')
  await expect(readout).toHaveText(/^F\s*0\s*\//)
  await expectVisible(timelineHeader.getByRole('button', { name: /^播放/ }), '停止后仍在播放')
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

try {
  await placeCharacter(lab, 'male', 0, 0)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 1", '主角落地')
  const hero = (await lab.scene()).objects[0]
  await clickOrFail(lab.outlinerRow(hero.name), '大纲·主角')
  // 先用正面预设，再经可见X字段挪到侧前方45°，默认朝前不能蒙混通过。
  await addCameraPreset(lab, '正面中景')
  await lab.waitScene('s.cameras.length === 1', '机位入场')
  let camera = (await lab.scene()).cameras[0]
  await clickOrFail(lab.outlinerRow(camera.name), '大纲·机位')
  const inspector = page.getByTestId('director-inspector')
  const cameraX = inspector.getByText('X', { exact: true }).locator('..').locator('input[type="text"]')
  const sideX = hero.position.x + Math.max(2, Math.abs(camera.position.z - hero.position.z))
  await cameraX.fill(String(sideX))
  await cameraX.press('Enter')
  await lab.waitScene(`s.cameras[0].position.x === ${sideX}`, '机位经X字段移到侧前方')
  camera = (await lab.scene()).cameras[0]
  check('机位位于侧前方，必须实际转头才对准', camera.position.z > hero.position.z && camera.position.x - hero.position.x >= 2, `camera=(${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)})`)

  // 动作片段 ×2（动作库弹窗：搜索 → 双击卡片）
  await addTrack(lab, hero.name)
  const addAction = async (query, cardLabel) => {
    await rowAddClipMenu(lab, hero.name, '内置动作片段')
    const modal = page.getByRole('dialog').filter({ hasText: '选择动作片段' })
    await expectVisible(modal, '动作库弹窗没打开')
    await modal.getByPlaceholder('搜索动作名称...').fill(query)
    await modal.getByText(cardLabel, { exact: true }).first().dblclick()
  }
  await addAction('单膝跪地', '单膝跪地')
  await lab.waitScene(`(s.objects.find(o => o.id === '${hero.id}').actionClips || []).length === 1`, '第一段动作片段')
  await page.mouse.move(700, 300)
  await page.keyboard.press('End')
  await addAction('站立', '站立')
  await lab.waitScene(`(s.objects.find(o => o.id === '${hero.id}').actionClips || []).length === 2`, '第二段动作片段')
  const clips = (await lab.scene()).objects.find((o) => o.id === hero.id).actionClips
  check('两段动作片段不重叠、顺序 跪 → 站', clips[0].endTime <= clips[1].startTime + 1e-6, clips.map((c) => `${c.actionId ?? c.name ?? '?'} ${c.startTime.toFixed(1)}~${c.endTime.toFixed(1)}`).join(' | '))
  await lab.snap('action-clips')

  // 先在视线有效区间取得“不注视”的同帧基线，再通过实际下拉指定侧前方摄像机。
  await rowAddClipMenu(lab, hero.name, '视线注视片段')
  await lab.waitScene(`(s.objects.find(o => o.id === '${hero.id}').lookAtClips || []).length === 1`, '视线片段')
  // 新加的片段自动成为选中片段 → 检查器出视线卡；目标类型是分段按钮（不注视 / 摄像机 / 物体）
  await expectVisible(inspector.getByText('视线片段', { exact: true }), '加了视线片段后检查器没切到视线卡')
  const lookClip = (await lab.scene()).objects.find(o => o.id === hero.id).lookAtClips[0]
  const middleFrame = Math.round((lookClip.startTime + lookClip.endTime) * 15)
  await stopAtStart()
  await clickOrFail(timelineHeader.getByRole('button', { name: /^播放/ }), '播放进入视线片段')
  await expectVisible(timelineHeader.getByRole('button', { name: /^暂停/ }), '播放未实际开始')
  await expect.poll(readFrame).toBeGreaterThanOrEqual(middleFrame)
  await clickOrFail(timelineHeader.getByRole('button', { name: /^暂停/ }), '在视线有效区间暂停')
  await expectVisible(timelineHeader.getByRole('button', { name: /^播放/ }), '未在片段中暂停')
  const pausedFrame = await readFrame()
  check('暂停帧在视线完全生效区间', pausedFrame > (lookClip.startTime + lookClip.blendInDuration) * 30 && pausedFrame < (lookClip.endTime - lookClip.blendOutDuration) * 30, `F${pausedFrame}, clip ${lookClip.startTime}~${lookClip.endTime}s`)
  const beforeHead = await lab.bridge('orientationByName', 'mixamorigHead', hero.id)
  const kneelingHip = await lab.bridge('orientationByName', 'mixamorigHips', hero.id)
  const targetDirection = head => norm([camera.position.x - head.position[0], 0, camera.position.z - head.position[2]])
  const horizontalForward = head => norm([head.forward[0], 0, head.forward[2]])
  const beforeAlignment = dot(horizontalForward(beforeHead), targetDirection(beforeHead))
  await lab.snap('kneeling-before-look')
  await clickOrFail(inspector.getByRole('radio', { name: '摄像机' }).or(inspector.getByRole('button', { name: '摄像机' })), '视线卡·注视目标=摄像机')
  await clickOrFail(inspector.getByRole('button', { name: '目标', exact: true }), '视线卡·打开目标下拉')
  await clickOrFail(page.getByRole('option', { name: camera.name, exact: true }), '视线卡·选择侧前方机位')
  await lab.waitScene(`(s.objects.find(o => o.id === '${hero.id}').lookAtClips || [])[0].targetType === 'camera' && s.objects.find(o => o.id === '${hero.id}').lookAtClips[0].targetId === '${camera.id}'`, '视线目标类型与ID均落盘')
  const aimedHead = await lab.bridge('orientationByName', 'mixamorigHead', hero.id)
  const afterAlignment = dot(horizontalForward(aimedHead), targetDirection(aimedHead))
  const turnDegrees = Math.acos(Math.max(-1, Math.min(1, dot(horizontalForward(beforeHead), horizontalForward(aimedHead))))) * 180 / Math.PI
  check('启用视线前后保持同一暂停帧', await readFrame() === pausedFrame, `F${pausedFrame}`)
  check('头骨实际朝侧前方机位转动，默认朝前不能通过', afterAlignment > 0.95 && afterAlignment - beforeAlignment > 0.12 && turnDegrees > 15, `cos ${beforeAlignment.toFixed(3)} → ${afterAlignment.toFixed(3)}, turn=${turnDegrees.toFixed(1)}°`)
  await lab.snap('paused-look-at-side-camera')

  // 视线片段后继续到动作终点，只核对站起，不再用失效视线片段证明转头。
  await clickOrFail(timelineHeader.getByRole('button', { name: /^播放/ }), '继续播放至站起完成')
  await expectVisible(timelineHeader.getByRole('button', { name: /^暂停/ }), '继续播放未实际开始')
  await expectVisible(timelineHeader.getByRole('button', { name: /^播放/ }), '未播放到内容末并暂停', stationTimeout({ operations: 2 }))
  const endFrame = Math.round(Math.max(...clips.map(clip => clip.endTime)) * 30)
  await expect.poll(readFrame).toBe(endFrame)
  const standingHip = await lab.bridge('orientationByName', 'mixamorigHips', hero.id)
  check('动作终点主角确实由跪姿站起', standingHip.position[1] > kneelingHip.position[1] + 0.15, `hips Y ${kneelingHip.position[1].toFixed(3)} → ${standingHip.position[1].toFixed(3)}, F${endFrame}`)
  await lab.snap('standing-at-action-end')

  // 骨骼把手：按住右手把手往上拖 → 静止姿态写入
  await stopAtStart()
  await clickOrFail(lab.outlinerRow(hero.name), '大纲·主角（重新选中）')
  await clickOrFail(page.getByRole('button', { name: '骨骼与 IK 把手' }), '底部栏·骨骼把手')
  // 拖把手前明确选择移动工具，使 gizmo 的操作模式可重复。
  await page.mouse.move(700, 300)
  await page.keyboard.press('1')
  await page.waitForTimeout(200)
  const handle = await lab.bridge('projectByName', 'ik-handle-rightHand', hero.id)
  check('右手把手投影到视口内', Boolean(handle) && handle.x > 0 && handle.y > 0, handle ? `(${handle.x.toFixed(0)}, ${handle.y.toFixed(0)})` : '没找到把手')
  // 交互：点把手 = 选中（平移 gizmo 挪过来），再按住 gizmo 中心拖
  await page.mouse.click(handle.x, handle.y)
  await page.waitForTimeout(300)
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(handle.x, handle.y - i * 8)
  await page.mouse.up()
  await lab.waitScene(`Object.keys((s.objects.find(o => o.id === '${hero.id}').boneRotations) || {}).length > 0`, 'IK 拖拽写入骨骼旋转')
  const bones = Object.keys((await lab.scene()).objects.find((o) => o.id === hero.id).boneRotations)
  check('IK 烘焙进右臂链骨骼', bones.some((name) => /RightArm|RightForeArm|RightShoulder/.test(name)), bones.join(','))
  await lab.snap('ik-drag')
} catch (error) {
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false)
  await lab.snap('journey-failed')
} finally {
  await lab.finish()
}
