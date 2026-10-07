// 10×10 群众（施工计划 docs/plan/2026-10-07-director-ual-mannequin.md §9 真实任务 ③）：
// 放一个人 → 时间轴给他加「走路」片段 → 基础页「批量生成群众队列」10 行 × 10 列 → 101 个 UAL 人偶 → 播放 3 秒量帧间隔 → 截图。
// 无界面 Chromium 是软件渲染（SwiftShader）：帧间隔只当相对参考，真 GPU 帧率另记 unverified。
// 用法：node tests/ux/director-ual-crowd.walk.mjs（先开着 `vite --port 5175` 走热路径）
import { addTrack, clickOrFail, expectVisible, launchDirectorLab, placeCharacter, rowAddClipMenu } from './_directorLab.mjs'

const lab = await launchDirectorLab({ name: 'ual-crowd', viewport: { width: 1600, height: 900 } })
const { page, check } = lab
const header = () => page.getByTestId('director-timeline-header')
/** 从头播放 3 秒，量 rAF 帧间隔，再停止回 0 帧 */
async function measurePlayback(label) {
  await clickOrFail(header().getByRole('button', { name: /^停止/ }), '停止回开头')
  await clickOrFail(header().getByRole('button', { name: /^播放/ }), '播放')
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
  await clickOrFail(header().getByRole('button', { name: /^停止/ }), '停止回开头')
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
  // 刚加的片段是选中态、检查器是片段卡：Esc 清掉再从大纲选主角
  await page.mouse.move(800, 300)
  await page.keyboard.press('Escape')
  await lab.pickInOutliner(hero.name, '大纲·主角')
  await clickOrFail(page.getByRole('radio', { name: '基础' }).first(), '检查器·基础')
  const card = page.getByTestId('director-inspector')
  const ranges = card.locator('input[type=range]')
  // 群众卡的三条滑条：行数 / 列数 / 间距（在基础页最后）
  const count = await ranges.count()
  await ranges.nth(count - 3).fill('10')
  await ranges.nth(count - 2).fill('10')
  await ranges.nth(count - 1).fill('1.2')
  await clickOrFail(page.getByTestId('director-crowd-confirm'), '确定生成')
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 101", '10×10 群众生成', 60_000)
  await page.waitForFunction(() => {
    const bridge = window.__nomiDirectorE2E
    return bridge && bridge.findAll('characterMount').length >= 101
  }, null, { timeout: 120_000 })
  check('101 个人偶都挂上了', (await lab.bridge('findAll', 'characterMount')).length >= 101)
  // 视角拉远看全体：Esc 清选择后按 F（无选中 = 框全部）
  await page.mouse.move(800, 300)
  await page.keyboard.press('Escape')
  await page.keyboard.press('f')
  await page.waitForTimeout(1500)
  await lab.snap('crowd-static')
  await clickOrFail(header().getByRole('button', { name: /^播放/ }), '播放（截播放中的样子）')
  await page.waitForTimeout(2500)
  await lab.snap('crowd-playing')
  const many = await measurePlayback('101 人')
  check('播放中有帧在走', many.frames > 1, JSON.stringify(many))
  console.log(`  · 101 人 / 1 人 帧间隔比：${(many.medianMs / Math.max(1, single.medianMs)).toFixed(1)}×`)
} catch (error) {
  check(`旅程中断：${String(error.message || error).split('\n')[0]}`, false)
  await lab.snap('journey-failed')
} finally {
  await lab.finish()
}
