// R16 旅程 J-D1「搭一个三人对话场景」（导演台 V2，方案 §7 S1 验收）。
// 真实任务：全新工程 → 放三个角色 → 给主角一台正面中景机位 → 加主光 → 画一个方块 → 大纲里改名 → 撤销。
// 证据：工程落盘的实体数与名字、画中画有机位画面、空态文案在空工程里真的出现、截图人眼核对。
// 用法：node tests/ux/director-j1-three-person-scene.walk.mjs
import { expectHidden } from './_assert.mjs'
import { addCameraPreset, clickOrFail, dragGround, expectVisible, launchDirectorLab, openAddMenu, placeCharacter } from './_directorLab.mjs'

const lab = await launchDirectorLab({ name: 'j1-three-person-scene' })
const { page, check } = lab

try {
  // 空工程的三处空态：大纲占位 / 时间轴提示 / 画中画「还没有机位」
  check('空工程·大纲空态', (await page.getByTestId('director-outliner').getByText('暂无实体').count()) === 1)
  check('空工程·时间轴空态', (await page.getByTestId('director-timeline-empty').count()) === 1)
  check('空工程·画中画无机位', (await page.getByTestId('director-pip').getByText('还没有机位').count()) === 1)
  await lab.snap('empty-project')

  await placeCharacter(lab, 'female', -1.4, 0.4)
  await placeCharacter(lab, 'male', 0, -0.6)
  await placeCharacter(lab, 'female', 1.4, 0.4)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 3", '三个角色落地')
  const afterPlace = await lab.scene()
  const characters = afterPlace.objects.filter((object) => object.type === 'character')
  check('放置三个角色', characters.length === 3, characters.map((c) => `${c.name}@(${c.position.x.toFixed(1)},${c.position.z.toFixed(1)})`).join(' '))
  check('角色落在点的地方（x 排成一行）', characters.every((c, i) => Math.abs(c.position.x - [-1.4, 0, 1.4][i]) < 0.35))
  const bounds = await lab.bridge('boundsByEntity', characters[1].id)
  check('假人贴地且身高约 1.7m', Boolean(bounds) && bounds.min[1] > -0.1 && bounds.max[1] - bounds.min[1] > 1.4 && bounds.max[1] - bounds.min[1] < 2.0, bounds ? `y ${bounds.min[1].toFixed(2)}…${bounds.max[1].toFixed(2)}` : '无包围盒')
  await lab.snap('three-characters')

  // 选中主角 → 相对它的正面中景机位
  await clickOrFail(lab.outlinerRow(characters[1].name), '大纲·主角行')
  await addCameraPreset(lab, '正面中景')
  await lab.waitScene('s.cameras.length === 1', '机位入场')
  const withCamera = await lab.scene()
  const camera = withCamera.cameras[0]
  check('正面中景机位在主角前方', camera.position.z > characters[1].position.z + 1 && Math.abs(camera.position.x - characters[1].position.x) < 1.5, `cam (${camera.position.x.toFixed(1)}, ${camera.position.z.toFixed(1)})`)
  await expectVisible(page.getByTestId('director-pip').getByText(camera.name), '画中画没显示新机位名')
  await expectHidden(page.getByTestId('director-pip').getByText('还没有机位'), '有机位了画中画还显示「还没有机位」')
  check('画中画显示机位画面（不再是「还没有机位」）', true)

  // 主光
  await openAddMenu({ page }, '灯光')
  await clickOrFail(page.getByRole('button', { name: '主光（平行光）' }), '灯光·主光')
  await lab.waitScene("s.lights.some(l => l.type === 'directional')", '主光入场')

  // 方块：拖底面 → 松开拉高 → 点击确认
  await openAddMenu({ page }, '方块')
  const drag = await dragGround(lab, [2.5, 2], [3.5, 3])
  await page.mouse.move(drag.to.x, drag.to.y - 90, { steps: 6 })
  await page.mouse.click(drag.to.x, drag.to.y - 90)
  await lab.waitScene("s.objects.some(o => o.type === 'cube')", '方块落地')
  const cube = (await lab.scene()).objects.find((object) => object.type === 'cube')
  check('方块有体积（底面约 1×1、拉出高度）', cube.scale.x > 0.5 && cube.scale.z > 0.5 && cube.scale.y > 0.2, `scale (${cube.scale.x.toFixed(2)}, ${cube.scale.y.toFixed(2)}, ${cube.scale.z.toFixed(2)})`)
  await lab.snap('camera-light-box')

  // 大纲重命名（双击 → 输入 → Enter）→ 撤销
  const row = lab.outlinerRow(characters[1].name)
  await row.dblclick()
  // 重命名输入框是大纲行的兄弟节点，不在 testid 元素里；搜索框有 placeholder，重命名框没有
  const input = page.getByTestId('director-outliner').locator('input:not([placeholder])').first()
  await expectVisible(input, '双击大纲行没进入重命名')
  await input.fill('小明')
  await input.press('Enter')
  await lab.waitScene("s.objects.some(o => o.name === '小明')", '重命名落盘')
  check('大纲重命名生效', (await lab.outlinerRow('小明').count()) === 1)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  await lab.waitScene(`s.objects.some(o => o.name === '${characters[1].name}')`, '撤销重命名')
  await expectHidden(lab.outlinerRow('小明'), '撤销后大纲里还叫「小明」')
  check('Ctrl+Z 撤回重命名', true)
  const stats = await lab.scene()
  check('场景 = 4 物体 · 1 机位', stats.objects.length === 4 && stats.cameras.length === 1, `${stats.objects.length} 物体 · ${stats.cameras.length} 机位`)
  await lab.snap('renamed-and-undone')
} catch (error) {
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false)
} finally {
  await lab.finish()
}
