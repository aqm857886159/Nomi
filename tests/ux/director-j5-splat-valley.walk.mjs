// R16 旅程 J-D5「站在泼溅山谷里推轨有视差」（导演台 V2，方案 §7 S5 验收）。
// 真实任务：资产库上传山谷 PLY → 双击入场 → 泼溅显现 → 放一个角色站在谷里 → W 推轨：近处角色在画面里移得比远处山坡多 = 视差。
// 证据：资产库出条目、场景里出泼溅实体、显现后 Spark 网格在场景树里、推轨前后近 / 远两点的屏幕位移比、截图。
// devlab 没有资产桥：上传走 blob URL 并 toast「临时」，旅程按这句文案断言（不假装落盘了）。
// 用法：node tests/ux/director-j5-splat-valley.walk.mjs
import path from 'node:path'
import { clickOrFail, expectVisible, launchDirectorLab, placeCharacter, repoRoot, writeValleyPly } from './_directorLab.mjs'
import { stationTimeout } from './_station-budget.mjs'

const lab = await launchDirectorLab({ name: 'j5-splat-valley' })
const { page, check } = lab

try {
  // 1.5 万高斯：headless 走 SwiftShader 软件渲染，够看出视差又不把主线程拖到点不动
  const ply = writeValleyPly(path.join(repoRoot, '.tmp', 'director-j5', 'valley.ply'), 15000)
  await clickOrFail(page.getByText('资产库', { exact: true }), '右栏·资产库')
  await page.locator('[data-testid="director-assets"] input[type="file"]').first().setInputFiles(ply)
  await lab.waitScene("(p.assets && p.assets.items || []).some(i => i.kind === 'splat')", '资产库出泼溅条目')
  // 条目行（缩进 pl-6）而不是包着它的文件夹行：hasText 会连后代文本一起匹配，双击文件夹只会折叠
  const entry = page.locator('[data-testid="director-assets"] div.pl-6', { hasText: 'valley' }).first()
  await expectVisible(entry, '资产库列表里没有 valley 条目')
  check('无桌面运行时时明说「临时」', (await lab.toasts()).some((text) => /临时|未落盘/.test(text)))
  await entry.dblclick()
  await lab.waitScene("s.objects.some(o => o.type === 'splat')", '泼溅实体入场')
  const splat = (await lab.scene()).objects.find((object) => object.type === 'splat')
  await page.waitForFunction((id) => {
    const info = window.__nomiDirectorE2E?.splatInfo(id)
    return info?.initialized && info.count === 15000 && !info.revealing
  }, splat.id, { timeout: stationTimeout({ operations: 4 }) })
  const splatInfo = await lab.bridge('splatInfo', splat.id)
  check('PLY 真实解码且完成显现', splatInfo.initialized && splatInfo.count === 15000 && !splatInfo.revealing, JSON.stringify(splatInfo))
  await lab.snap('splat-loaded')

  await clickOrFail(page.getByText('场景对象', { exact: true }), '右栏·场景对象')
  await placeCharacter(lab, 'female', 0, 2)
  await lab.waitScene("s.objects.some(o => o.type === 'character')", '角色落地')
  const hero = (await lab.scene()).objects.find((object) => object.type === 'character')
  await page.waitForFunction((id) => {
    const extent = window.__nomiDirectorE2E?.boneExtentByEntity(id)
    return extent && extent.maxY - extent.minY > 1
  }, hero.id)
  const body = await lab.bridge('boundsByEntity', hero.id)
  check('角色站在谷底，完整身体在地面之上', body.min[1] >= -0.15 && body.max[1] > 1.5, `Y=${body.min[1].toFixed(2)}…${body.max[1].toFixed(2)}`)
  await page.keyboard.press('Escape')
  await lab.snap('character-in-valley')

  // 视差：推轨前后，近处（角色头顶）与远处（谷地远点）的屏幕位移
  const near = [hero.position.x, 1.6, hero.position.z]
  const far = [6, 2.5, -22]
  const nearBefore = await lab.bridge('projectPoint', ...near)
  const farBefore = await lab.bridge('projectPoint', ...far)
  await page.mouse.move(600, 260)
  await page.keyboard.down('KeyD')
  await page.waitForTimeout(700)
  await page.keyboard.up('KeyD')
  await page.waitForTimeout(200)
  const nearAfter = await lab.bridge('projectPoint', ...near)
  const farAfter = await lab.bridge('projectPoint', ...far)
  const nearShift = Math.hypot(nearAfter.x - nearBefore.x, nearAfter.y - nearBefore.y)
  const farShift = Math.hypot(farAfter.x - farBefore.x, farAfter.y - farBefore.y)
  check('横移推轨：近处角色位移 > 远处山坡位移（视差）', nearShift > farShift * 1.5 && nearShift > 20, `近 ${nearShift.toFixed(0)}px · 远 ${farShift.toFixed(0)}px`)
  await lab.snap('after-truck')
} catch (error) {
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false, String(error.stack || '').split('\n').slice(1, 4).join(' ⇐ '))
} finally {
  await lab.finish()
}
