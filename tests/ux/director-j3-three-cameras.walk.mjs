// R16 旅程 J-D3「三机位切换的一段对话」（导演台 V2，方案 §7 S3 验收）。
// 真实任务：放主角 → 三台预设机位 → 画中画「进入视角」→ R 录一段运镜（转视角）→ R 完成 → 退出机位
//           → 给主角轨「创建特写片段」= 第四台机位 + 特写片段 → Space 播放时画中画切到节目机位（LIVE）。
// 证据：机位数、录制关键帧、分组主体的特写→路径同帧三维取景与世界位姿、单步撤销、画中画 LIVE。
// 用法：node tests/ux/director-j3-three-cameras.walk.mjs
import { expectAbsent, expectHidden, proveProbe, screenshotSettled } from './_assert.mjs'
import { addCameraPreset, addTrack, clickOrFail, expectVisible, launchDirectorLab, placeCharacter, trackMenu } from './_directorLab.mjs'

const lab = await launchDirectorLab({ name: 'j3-three-cameras' })
const { page, check } = lab

try {
  await placeCharacter(lab, 'male', 0, 0)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 1", '主角落地')
  const hero = (await lab.scene()).objects[0]
  await clickOrFail(lab.outlinerRow(hero.name), '大纲·主角')
  // 预设机位相对选中主体，建完一台主体会被取消选中，下一台前要重新选主角
  for (const preset of ['正面中景', '侧面近景', '俯拍全景']) {
    await clickOrFail(lab.outlinerRow(hero.name), '大纲·主角（机位相对主体）')
    await addCameraPreset(lab, preset)
  }
  await lab.waitScene('s.cameras.length === 3', '三台机位')
  const cameras = (await lab.scene()).cameras
  check('三台预设机位位置各不相同', new Set(cameras.map((c) => `${c.position.x.toFixed(1)},${c.position.y.toFixed(1)},${c.position.z.toFixed(1)}`)).size === 3)
  await lab.snap('three-cameras')

  // 画中画切到机位 1 → 进入视角
  const pip = page.getByTestId('director-pip')
  await clickOrFail(pip.getByRole('button', { name: '进入视角' }), '画中画·进入视角')
  await expectVisible(page.getByTestId('director-pov-hud'), '没进入机位视角（POV HUD 没出现）')
  const hudText = await page.getByTestId('director-pov-hud').innerText()
  const povCamera = cameras.find((c) => hudText.includes(c.name))
  check('HUD 显示所在机位与焦距', Boolean(povCamera) && /\d+mm/.test(hudText), hudText.split('\n')[0])
  check('画幅引导框出现', (await page.getByTestId('director-aspect-guide').count()) === 1)
  await lab.snap('pov-entered')

  // R 录制：拖视口转视角 → R 完成
  await page.mouse.move(600, 300)
  await page.keyboard.press('r')
  await expectVisible(page.getByText(/录制中/), '按 R 没开始录制')
  await page.mouse.move(600, 300)
  await page.mouse.down()
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(600 + i * 12, 300 + i * 2)
  await page.mouse.up()
  await page.waitForTimeout(600)
  await page.keyboard.press('r')
  await lab.waitScene(`(s.cameras.find(c => c.id === '${povCamera.id}').trajectoryClips || []).length === 1`, '录制生成路径片段')
  const recorded = (await lab.scene()).cameras.find((c) => c.id === povCamera.id)
  check('录制简化成关键帧（≥ 2）', (recorded.motionTrajectory || []).length >= 2, `${(recorded.motionTrajectory || []).length} 关键帧`)
  check('录制后 toast 提示回放', (await lab.toasts()).some((text) => /空格|回放/.test(text)))
  await lab.snap('recorded')

  await clickOrFail(page.getByTestId('director-pov-hud').getByRole('button', { name: '退出机位' }), 'HUD·退出机位')
  await expectHidden(page.getByTestId('director-pov-hud'), '退出机位后 POV HUD 还在')
  check('退出后 HUD 消失', true)

  // 主角轨 → 创建特写片段：新机位 + 4s 特写
  await addTrack(lab, hero.name)
  await trackMenu(lab, hero.name, '创建特写片段')
  await lab.waitScene('s.cameras.length === 4 && s.cameras.some(c => (c.closeupClips || []).length === 1)', '特写片段与第四台机位')
  const closeupCamera = (await lab.scene()).cameras.find((c) => (c.closeupClips || []).length === 1)
  const closeup = closeupCamera.closeupClips[0]
  check('特写片段约 4s 且目标是主角', closeup.endTime - closeup.startTime > 3.5 && closeup.targetObjectId === hero.id, `${(closeup.endTime - closeup.startTime).toFixed(1)}s`)
  await expectVisible(lab.trackRow(closeupCamera.name), '特写机位没进时间轴')
  await lab.snap('closeup-created')

  // 全部生产交互：给特写主体加父组，再用检查器平移/旋转父组，拒绝仅在原点碰巧对齐的证明。
  await placeCharacter(lab, 'female', 2, 0)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 2", '陪衬角色落地')
  const companion = (await lab.scene()).objects.find((item) => item.type === 'character' && item.id !== hero.id)
  await lab.outlinerRow(hero.name).click()
  await lab.outlinerRow(companion.name).click({ modifiers: ['Control'] })
  await page.getByTestId('director-selection-bar').getByRole('button', { name: '打组', exact: true }).click()
  await lab.waitScene("s.objects.some(o => o.type === 'group')", '两个角色真实打组')
  const group = (await lab.scene()).objects.find((item) => item.type === 'group')
  await lab.outlinerRow(group.name).click()
  const inspector = page.getByTestId('director-inspector')
  for (const [label, value] of [['X', '3'], ['水平', '35']]) {
    const field = inspector.locator('label').filter({ has: page.getByText(label, { exact: true }) }).first().locator('input[type="text"]')
    await field.fill(value)
    await field.press('Enter')
  }
  await lab.waitScene(`s.objects.some(o => o.id === '${group.id}' && o.position.x === 3 && o.rotation.y === 35)`, '父组平移与旋转写入工程')
  const heroLocal = (await lab.scene()).objects.find((item) => item.id === hero.id)
  const heroWorld = await lab.bridge('orientationByName', 'characterMount', hero.id)
  check('特写主体确实位于非默认父空间', heroLocal.parentId === group.id && Math.abs(heroWorld.position[0] - heroLocal.position.x) > 1, `local X=${heroLocal.position.x.toFixed(3)}, world X=${heroWorld.position[0].toFixed(3)}, parent yaw=35°`)
  const closeupBar = page.locator(`[data-clip-id="${closeup.id}"]`)
  await closeupBar.click()
  const clipRect = await closeupBar.boundingBox(), rulerRect = await page.getByTestId('director-timeline-ruler').boundingBox()
  await page.mouse.click(clipRect.x + clipRect.width / 4, rulerRect.y + 10)
  const frameBefore = await page.getByTestId('director-frame-readout').innerText()
  check('转换前时间轴暂停在特写内部', await page.getByTestId('director-timeline-header').getByRole('button', { name: /^播放/ }).isVisible(), frameBefore.replaceAll('\n', ' '))
  await pip.getByLabel('预览机位').click()
  await page.getByRole('option', { name: closeupCamera.name, exact: true }).click()
  const beforeProject = await lab.project()
  const poseBefore = await lab.bridge('orientationByName', `cam_${closeupCamera.id}`, closeupCamera.id)
  const preview = pip.locator('div[style*="aspect-ratio"]').first()
  await lab.snap('grouped-closeup-before-bake')
  await screenshotSettled(preview, { path: `${lab.shotsDir}/closeup-before-bake-pip.png` })
  const closeupProof = await proveProbe(closeupBar, '转换前真实特写条存在')
  await inspector.getByRole('button', { name: '转为路径', exact: true }).click()
  await lab.waitScene(`s.cameras.some(c => c.id === '${closeupCamera.id}' && !c.closeupClips?.length && c.trajectoryClips?.length === 1)`, '特写已转换为路径')
  await expectAbsent(closeupBar, { provenBy: closeupProof, message: '转换后原特写条持续退出时间轴' })
  const baked = (await lab.scene()).cameras.find((item) => item.id === closeupCamera.id)
  const poseAfter = await lab.bridge('orientationByName', `cam_${closeupCamera.id}`, closeupCamera.id)
  const positionDelta = Math.hypot(...poseAfter.position.map((value, i) => value - poseBefore.position[i]))
  const directionDelta = Math.hypot(...poseAfter.forward.map((value, i) => value - poseBefore.forward[i]))
  check('烘焙保留原片段范围且有12个关键帧', baked.motionTrajectory.length === 12 && baked.trajectoryClips[0].startTime === closeup.startTime && baked.trajectoryClips[0].endTime === closeup.endTime)
  check('同一暂停帧的世界机位位置与朝向不跳变', frameBefore === await page.getByTestId('director-frame-readout').innerText() && positionDelta < 1e-5 && directionDelta < 1e-5, JSON.stringify({ before: poseBefore, after: poseAfter, positionDelta, directionDelta }))
  await lab.snap('grouped-path-after-bake')
  await screenshotSettled(preview, { path: `${lab.shotsDir}/path-after-bake-pip.png` })
  await page.mouse.move(600, 300)
  await page.keyboard.press('Control+z')
  await lab.waitScene(`s.cameras.some(c => c.id === '${closeupCamera.id}' && c.closeupClips?.length === 1 && !c.trajectoryClips?.length)`, '一次撤销恢复特写')
  check('一次撤销完整恢复转换前工程', JSON.stringify(beforeProject) === JSON.stringify(await lab.project()))

  // 播放：画中画切到节目机位并标 LIVE
  await page.mouse.move(600, 300)
  await page.keyboard.press(' ')
  await expectVisible(pip.getByText('LIVE'), '播放时画中画没标 LIVE')
  await lab.snap('playing-live')
  await page.keyboard.press(' ')
  check('主角检查器仍可用（没被机位状态卡死）', (await page.getByTestId('director-inspector').count()) === 1)
} catch (error) {
  console.error(error)
  await page.screenshot({ path: `${lab.shotsDir}/failure.png` }).catch(() => {})
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false)
} finally {
  await lab.finish()
}
