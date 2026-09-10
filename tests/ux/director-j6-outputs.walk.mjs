// R16 旅程 J-D6「截一张图、录一段 MP4、送回画布」（导演台 V2，方案 §7 S6 验收）。
// 真实任务：放主角 + 机位 → Ctrl+Shift+P 截图 → 「产出 1」弹层列出截图 → 录制 MP4：没片段时明说原因 →
//           进机位录一段运镜 → 再录 MP4 → devlab 没有 ffmpeg 桥：采满帧后明说「无法编码」而不是假成功。
// 证据：产物落进工程（只存句柄）、弹层文案、两句诚实的降级提示、录制进度按钮出现过、截图。
// 用法：node tests/ux/director-j6-outputs.walk.mjs
import { addCameraPreset, clickOrFail, expectVisible, launchDirectorLab, placeCharacter } from './_directorLab.mjs'
import { stationTimeout } from './_station-budget.mjs'

const lab = await launchDirectorLab({ name: 'j6-outputs' })
const { page, check } = lab

try {
  await placeCharacter(lab, 'female', 0, 0)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 1", '主角落地')
  const hero = (await lab.scene()).objects[0]
  await clickOrFail(lab.outlinerRow(hero.name), '大纲·主角')
  await addCameraPreset(lab, '正面特写')
  await lab.waitScene('s.cameras.length === 1', '机位入场')
  const camera = (await lab.scene()).cameras[0]

  // 截图（自由视角）→ 产出 1
  await page.mouse.move(600, 300)
  await page.keyboard.press('Control+Shift+p')
  await lab.waitScene('(p.outputs && p.outputs.screenshots || []).length === 1', '截图进产物')
  const shot = (await lab.project()).outputs.screenshots[0]
  check('截图命名「自由漫游·全景-截图1」', /自由漫游.*截图1/.test(shot.name), shot.name)
  check('产物只存句柄，不存 base64', typeof shot.assetUrl === 'string' && !shot.assetUrl.startsWith('data:'), shot.assetUrl.slice(0, 40))
  check('无桌面运行时明说截图未落盘', (await lab.toasts()).some((text) => /未落盘|仅本次会话/.test(text)))
  const outputsButton = page.getByTestId('director-deliver-cluster').getByRole('button', { name: /^产出 1$/ })
  await clickOrFail(outputsButton, '底栏·产出 1')
  const popover = page.locator('[data-nomi-escape-layer="director-popover"]').first()
  await expectVisible(popover, '产出弹层没打开')
  check('弹层列出截图', (await popover.getByText(shot.name).count()) === 1)
  const send = popover.getByRole('button', { name: '发送到画布' }).first()
  // 原因挂在包着按钮的 span 的 title 上（禁用按钮自身收不到 hover）
  const sendReason = await send.locator('xpath=..').getAttribute('title')
  check('开发入口「发送到画布」禁用并说明原因', (await send.isDisabled()) && String(sendReason).includes('开发入口没有画布'), String(sendReason))
  await lab.snap('outputs-popover')
  await page.keyboard.press('Escape')

  // 录制 MP4：没片段 → 明说
  await clickOrFail(page.getByTestId('director-timeline-header').getByRole('button', { name: '录制 MP4' }), '时间轴头部·录制 MP4')
  check('没片段时明说原因', (await lab.toasts()).some((text) => /没有片段/.test(text)))

  // 进机位录一段运镜 → 机位有路径片段
  await clickOrFail(page.getByTestId('director-pip').getByRole('button', { name: '进入视角' }), '画中画·进入视角')
  await expectVisible(page.getByTestId('director-pov-hud'), '没进入机位视角')
  await page.mouse.move(600, 300)
  await page.keyboard.press('r')
  await expectVisible(page.getByText(/录制中/), '按 R 没开始录制')
  await page.mouse.move(600, 300)
  await page.mouse.down()
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(600 + i * 10, 300)
  await page.mouse.up()
  await page.waitForTimeout(700)
  await page.keyboard.press('r')
  await lab.waitScene(`(s.cameras.find(c => c.id === '${camera.id}').trajectoryClips || []).length === 1`, '运镜片段')
  await clickOrFail(page.getByTestId('director-pov-hud').getByRole('button', { name: '退出机位' }), 'HUD·退出机位')

  // 再录 MP4：逐帧采样 → 无桥 → 诚实降级
  await clickOrFail(page.getByTestId('director-timeline-header').getByRole('button', { name: '录制 MP4' }), '时间轴头部·录制 MP4（第二次）')
  await expectVisible(page.getByTestId('director-timeline-header').getByText(/录制中 \d+ \/ \d+ 帧/), '录制进度按钮没出现')
  await lab.snap('recording-progress')
  // headless 走 SwiftShader，1080p 逐帧离屏渲染比真机慢一个量级：上限给到 5 分钟
  await expectVisible(page.getByText(/采到 \d+ 帧但无法编码/), '无桌面运行时应明说无法编码 MP4', stationTimeout({ operations: 20 }))
  const videos = (await lab.project()).outputs.videos || []
  check('没有假装生成视频（videos 仍为空）', Array.isArray(videos) && videos.length < 1, `${videos.length} 条`)
  check('截图产物仍在', ((await lab.project()).outputs.screenshots || []).length === 1)
  await lab.snap('no-bridge-honest')
} catch (error) {
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false)
} finally {
  await lab.finish()
}
