// R13 真机走查：画布操作语义（#832 二选一，2026-07-31 用户拍板 / 2026-08-03 补齐）。
// A 档 wheel-zoom（默认）：① 空白拖 = 平移；② 滚轮 = 缩放且锚在光标；
//   ③ Shift+拖空白 = 框选、Shift+点节点 = 多选切换、纯点空白 = 清选区；④ 空格+拖 = 平移（压在节点上也行）。
// B 档 modifier-zoom（走真设置 UI 切过去）：⑤ 滚轮 = 平移且倍率不变；⑥ ⌘+滚轮 = 缩放；⑦ 提示卡文案跟着换。
// 截图人眼判断 + 程序断言（节点位移/锚点漂移/选中数）双保险。
// 用法：node scripts/canvas-gestures-walkthrough.mjs
import { launchNomiApp, repoRoot } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import path from 'node:path'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'

const outDir = path.join(repoRoot, '.canvas-gestures-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

const { app, win } = await launchNomiApp({
  name: 'canvas-gestures',
  settingsDir: mkdtempSync(path.join(os.tmpdir(), 'canvas-gestures-settings-')),
  projectsDir: mkdtempSync(path.join(os.tmpdir(), 'canvas-gestures-proj-')),
})
const errors = []
let failed = false
const check = (ok, label) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + label)
  if (!ok) failed = true
}

try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
  await win.waitForTimeout(1500)

  // 建 2 个图片节点（多选/框选素材）
  for (let i = 0; i < 2; i += 1) {
    await addCanvasNodeFromRail(win, 'image')
    await win.waitForTimeout(600)
    await win.keyboard.press('Escape')
    await win.waitForTimeout(300)
  }
  const nodes = win.locator('.generation-canvas-v2-node')
  const nodeCount = await nodes.count()
  check(nodeCount === 2, `画布节点数 = ${nodeCount}（预期 2）`)
  await shot(win, '01-baseline.png')

  const stage = await win.locator('.generation-canvas-v2__stage').boundingBox()
  const nodeBoxA0 = await nodes.nth(0).boundingBox()
  const nodeBoxB0 = await nodes.nth(1).boundingBox()

  // ─── ① 左键按住空白拖 = 平移 ───
  // 空白点取节点联合包围盒左上外侧（避开顶部工具栏/手势提示：至少离 stage 顶 120px）
  const blankX = Math.max(stage.x + 40, Math.min(nodeBoxA0.x, nodeBoxB0.x) - 80)
  const blankY = Math.max(stage.y + 130, Math.min(nodeBoxA0.y, nodeBoxB0.y) - 60)
  await win.mouse.move(blankX, blankY)
  await win.mouse.down()
  await win.mouse.move(blankX + 240, blankY + 140, { steps: 8 })
  await shot(win, '02-pan-dragging.png')
  await win.mouse.up()
  await win.waitForTimeout(400)
  const nodeBoxA1 = await nodes.nth(0).boundingBox()
  const nodeBoxB1 = await nodes.nth(1).boundingBox()
  const dxA = nodeBoxA1.x - nodeBoxA0.x
  const dyA = nodeBoxA1.y - nodeBoxA0.y
  const dxB = nodeBoxB1.x - nodeBoxB0.x
  check(Math.abs(dxA - 240) < 8 && Math.abs(dyA - 140) < 8, `空白拖 → 画布平移（节点位移 ${Math.round(dxA)},${Math.round(dyA)} ≈ 240,140）`)
  check(Math.abs(dxB - 240) < 8, '两个节点同步位移（整体平移而非拖动了单节点）')
  await shot(win, '03-pan-done.png')

  // ─── ② 滚轮 = 缩放，锚在光标 ───
  // 锚点取节点 A 中心：缩放后该点应仍钉在光标下（漂移 < 12px）
  const anchorBox = await nodes.nth(0).boundingBox()
  const anchorX = anchorBox.x + anchorBox.width / 2
  const anchorY = anchorBox.y + anchorBox.height / 2
  await win.mouse.move(anchorX, anchorY)
  await win.mouse.wheel(0, -240) // 两档上滚 = 放大
  await win.waitForTimeout(500)
  const zoomedBox = await nodes.nth(0).boundingBox()
  const zoomRatio = zoomedBox.width / anchorBox.width
  const zoomedCenterX = zoomedBox.x + zoomedBox.width / 2
  const zoomedCenterY = zoomedBox.y + zoomedBox.height / 2
  const drift = Math.hypot(zoomedCenterX - anchorX, zoomedCenterY - anchorY)
  check(zoomRatio > 1.2, `滚轮上滚 → 放大（节点宽 ×${zoomRatio.toFixed(2)}）`)
  check(drift < 12, `缩放锚在光标（锚点漂移 ${drift.toFixed(1)}px < 12px）`)
  await shot(win, '04-wheel-zoom-in.png')
  await win.mouse.wheel(0, 240) // 滚回原倍率
  await win.waitForTimeout(500)
  const restoredBox = await nodes.nth(0).boundingBox()
  check(Math.abs(restoredBox.width / anchorBox.width - 1) < 0.05, '滚轮下滚 → 缩小（回到原倍率）')

  // ─── ③ Shift+拖 = 框选；Shift+点 = 多选切换；纯点空白 = 清选区 ───
  const boxA = await nodes.nth(0).boundingBox()
  const boxB = await nodes.nth(1).boundingBox()
  const unionLeft = Math.min(boxA.x, boxB.x)
  const unionTop = Math.min(boxA.y, boxB.y)
  const unionRight = Math.max(boxA.x + boxA.width, boxB.x + boxB.width)
  const unionBottom = Math.max(boxA.y + boxA.height, boxB.y + boxB.height)
  const marqueeFromX = Math.max(stage.x + 20, unionLeft - 50)
  const marqueeFromY = Math.max(stage.y + 130, unionTop - 50)
  await win.keyboard.down('Shift')
  await win.mouse.move(marqueeFromX, marqueeFromY)
  await win.mouse.down()
  await win.mouse.move(unionRight + 50, unionBottom + 50, { steps: 8 })
  const marqueeVisible = await win.locator('.generation-canvas-v2__marquee').count()
  check(marqueeVisible > 0, 'Shift+拖 → 画出框选矩形')
  await shot(win, '05-marquee-dragging.png')
  await win.mouse.up()
  await win.keyboard.up('Shift')
  await win.waitForTimeout(400)
  const selectedAfterMarquee = await win.locator('.generation-canvas-v2-node[data-selected="true"]').count()
  check(selectedAfterMarquee === 2, `框选罩住两节点 → 选中 ${selectedAfterMarquee}/2`)
  await shot(win, '06-marquee-selected.png')

  // 纯点空白 = 清选区（原框选路径让位后由平移路径接管，回归验证）
  await win.mouse.click(marqueeFromX, marqueeFromY)
  await win.waitForTimeout(400)
  const selectedAfterBlankClick = await win.locator('.generation-canvas-v2-node[data-selected="true"]').count()
  check(selectedAfterBlankClick === 0, '纯点空白 → 清空选区')

  // Shift+点选：A 单选 → Shift+点 B 追加 → Shift+再点 B 反选
  await nodes.nth(0).click({ position: { x: 20, y: 12 } })
  await win.waitForTimeout(300)
  await nodes.nth(1).click({ position: { x: 20, y: 12 }, modifiers: ['Shift'] })
  await win.waitForTimeout(300)
  const selectedAfterShiftClick = await win.locator('.generation-canvas-v2-node[data-selected="true"]').count()
  check(selectedAfterShiftClick === 2, `点选 A + Shift+点 B → 选中 ${selectedAfterShiftClick}/2`)
  await shot(win, '07-shift-click-multi.png')
  await nodes.nth(1).click({ position: { x: 20, y: 12 }, modifiers: ['Shift'] })
  await win.waitForTimeout(300)
  const selectedAfterToggle = await win.locator('.generation-canvas-v2-node[data-selected="true"]').count()
  check(selectedAfterToggle === 1, `Shift+再点 B → 反选回 ${selectedAfterToggle}/1`)
  await shot(win, '08-shift-click-toggle.png')

  // ─── ④ 空格+拖 = 平移（PR#56 越界删掉、2026-08-03 恢复）───
  // 刻意把光标压在**节点上**按下：空白左键拖这时会被节点接走，只有空格档能平移——这正是它存在的理由。
  const spaceNodeBox = await nodes.nth(0).boundingBox()
  const spaceFromX = spaceNodeBox.x + spaceNodeBox.width / 2
  const spaceFromY = spaceNodeBox.y + 12
  const beforeSpace = await nodes.nth(0).boundingBox()
  await win.keyboard.down('Space')
  await win.waitForTimeout(200)
  const grabCursor = await win.locator('.generation-canvas-v2__stage').getAttribute('data-space-pan')
  check(grabCursor === 'true', '空格按住 → 外壳切平移态（data-space-pan，光标 grab）')
  await win.mouse.move(spaceFromX, spaceFromY)
  await win.mouse.down()
  await win.mouse.move(spaceFromX - 120, spaceFromY + 90, { steps: 8 })
  await shot(win, '09-space-pan-dragging.png')
  await win.mouse.up()
  await win.keyboard.up('Space')
  await win.waitForTimeout(400)
  const afterSpace = await nodes.nth(0).boundingBox()
  const spaceDx = afterSpace.x - beforeSpace.x
  const spaceDy = afterSpace.y - beforeSpace.y
  check(
    Math.abs(spaceDx + 120) < 10 && Math.abs(spaceDy - 90) < 10,
    `空格+拖（压在节点上）→ 画布平移（位移 ${Math.round(spaceDx)},${Math.round(spaceDy)} ≈ -120,90）`,
  )
  const spaceReleased = await win.locator('.generation-canvas-v2__stage').getAttribute('data-space-pan')
  check(spaceReleased === null, '松开空格 → 平移态复位（不卡在 grab）')
  await shot(win, '10-space-pan-done.png')

  // ─── ⑤⑥⑦ 切到 modifier-zoom 档：走真设置 UI，不直接改 localStorage ───
  const hintBefore = await win.locator('.generation-canvas-v2__gesture-hint').textContent().catch(() => '')
  await win.locator('.nomi-appbar__ghost[aria-label="设置"]').first().click()
  await win.waitForTimeout(800)
  // 必须锚在对话框内：'通用' 这两个字在别处也有（隐藏的 caption span），全局 getByText 会选中它然后死等可见。
  const settingsDialog = win.locator('[role="dialog"][aria-label="设置"]')
  check(await settingsDialog.count() > 0, '齿轮 → 设置对话框打开')
  await settingsDialog.getByRole('button', { name: '通用' }).click()
  await win.waitForTimeout(500)
  await shot(win, '11-settings-general.png')
  const schemeChip = win.locator('[data-canvas-gesture-scheme="modifier-zoom"]')
  check(await schemeChip.count() > 0, '设置 · 通用里有「画布滚轮」二选一')
  await schemeChip.click()
  await win.waitForTimeout(300)
  const chipChecked = await schemeChip.getAttribute('aria-checked')
  check(chipChecked === 'true', '点「平移」档 → 芯片选中态生效')
  await shot(win, '12-settings-scheme-picked.png')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(600)

  const hintAfter = await win.locator('.generation-canvas-v2__gesture-hint').textContent().catch(() => '')
  check(
    hintBefore !== hintAfter && /滚轮/.test(hintAfter || '') && /⌘/.test(hintAfter || ''),
    `提示卡文案跟着换档（现含 ⌘+滚轮：${JSON.stringify((hintAfter || '').slice(0, 40))}）`,
  )

  // ⑤ 这一档裸滚轮 = 平移，倍率不能变
  const panBox0 = await nodes.nth(0).boundingBox()
  await win.mouse.move(panBox0.x + panBox0.width / 2, panBox0.y + panBox0.height / 2)
  await win.mouse.wheel(0, 120)
  await win.waitForTimeout(500)
  const panBox1 = await nodes.nth(0).boundingBox()
  check(
    Math.abs(panBox1.y - panBox0.y + 120) < 12,
    `modifier-zoom 档：滚轮 → 平移（节点纵向位移 ${Math.round(panBox1.y - panBox0.y)} ≈ -120）`,
  )
  check(Math.abs(panBox1.width / panBox0.width - 1) < 0.02, '滚轮平移时倍率不变（没顺手缩放）')
  await shot(win, '13-modifier-wheel-pan.png')

  // ⑥ ⌘+滚轮仍是缩放——这一档下它是唯一的缩放入口，断了这条这一档就废了
  const zoomBox0 = await nodes.nth(0).boundingBox()
  await win.mouse.move(zoomBox0.x + zoomBox0.width / 2, zoomBox0.y + zoomBox0.height / 2)
  await win.keyboard.down('Meta')
  await win.mouse.wheel(0, -240)
  await win.keyboard.up('Meta')
  await win.waitForTimeout(500)
  const zoomBox1 = await nodes.nth(0).boundingBox()
  check(
    zoomBox1.width / zoomBox0.width > 1.2,
    `modifier-zoom 档：⌘+滚轮 → 放大（节点宽 ×${(zoomBox1.width / zoomBox0.width).toFixed(2)}）`,
  )
  await shot(win, '14-modifier-cmd-wheel-zoom.png')
} catch (error) {
  failed = true
  console.error('  ✗ 走查中断: ' + (error instanceof Error ? error.message : String(error)))
} finally {
  if (errors.length) {
    console.log('  ⚠ 渲染进程报错 ' + errors.length + ' 条：')
    for (const line of errors.slice(0, 5)) console.log('    ' + line)
  }
  await app.close().catch(() => {})
}
console.log(failed ? '\n✗ 画布手势走查未通过' : '\n✓ 画布手势走查通过')
process.exit(failed ? 1 : 0)
