// 生成框参考行「+」→「上传本地文件」：上传完成就接到这张卡上（2026-10-27 回归；设计卡 docs/plan/2026-10-27-composer-upload-connect.md）。
//
// 这一类是怎么漏的：完成时「接不接」原来读的是「生成框还挂着吗」。可导入建卡会把选中切到新卡，而画布里的生成框只在这张卡
// 被单选时挂着——这次动作自己把生成框卸掉了，完成时读到「没挂着」就当成用户关掉了选择器，不接。单测把 shouldConnect
// 写死成 true，真顺序没人走过。
// 这里按「宿主 × 用户动作」走真顺序：真参考区组件 + 真 store + 真导入链，只桩掉桌面桥；磁盘余量与落盘各挂一道闸，由测试放行，
// 「建卡前」「建卡后、完成前」两段都钉得住，不赌时序。
//   宿主：canvas（这张卡单选才挂生成框）/ inline（列表内嵌，不随选中卸载）。以后多一种宿主，矩阵加一行。
//   动作：不碰 → 接上、选中回到这张卡、生成框里看得到新参考、一步撤销；
//         用户按 Esc 关掉选择器（画布宿主只来得及在建卡前关；列表宿主建卡后也能关）→ 只留素材卡、不接、不还选中（10-09 语义）；
//         途中自己点了别的卡 → 照样接上，选中留在用户点的那张。
import { expect, test } from 'vitest'
import { chromium } from 'playwright'
import { expectAbsent, proveProbe } from './_assert.mjs'
import { useBrowserFixture } from './_browserFixture.mjs'

const ENTRY = 'tests/ux/fixtures/composer-upload-connect-harness.html'
const fixture = useBrowserFixture({ entries: [ENTRY], browserType: chromium, ready: '[data-harness-composer] [data-asset-add-tile]' })
// 64×48 的真 PNG：导入要先解码量尺寸，坏图会在建卡前就被判失败。
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAZElEQVR4nO3PUQkAIBTAwBfbEAYzliH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY8dgHBeJE8lWpuzQAAAABJRU5ErkJggg==', 'base64')
// 等应用自己的异步活（解码、建卡、低优先级挂卸）的安全网，不是完成条件；完成条件都是下面断言里的状态。
const SETTLE = { timeout: 15_000 }

const MATRIX = [
  { host: 'canvas', action: 'keep', outcome: 'connected' },
  { host: 'canvas', action: 'dismiss-before-card', outcome: 'card-only' },
  { host: 'canvas', action: 'select-other', outcome: 'connected' },
  { host: 'inline', action: 'keep', outcome: 'connected' },
  { host: 'inline', action: 'dismiss-after-card', outcome: 'card-only' },
]

for (const cell of MATRIX) test(`${cell.host} host × ${cell.action} → ${cell.outcome}`, async () => {
  const page = await fixture.browser.newPage()
  try {
    await page.goto(fixture.url(ENTRY, `?host=${cell.host}`))
    const harness = (method, ...args) => page.evaluate(([name, values]) => window.composerUpload[name](...values), [method, args])
    const composer = page.locator('[data-harness-composer]')
    const picker = page.locator('[data-testid="asset-picker"]')
    await composer.locator('[data-asset-add-tile]').click()
    // 后面要断言「选择器 / 生成框没了」：先证明两个探针此刻都找得到，「没了」才不是探针失效的空话。
    const pickerProof = await proveProbe(picker, 'asset picker opened from the reference row')
    const composerProof = await proveProbe(composer, 'composer mounted for the target card')
    await picker.locator('input[type="file"]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: PNG })
    // 导入已经开始、卡还没建：停在量磁盘余量那道闸上，选择器还开着。
    await expect.poll(() => harness('calls').then((calls) => calls.capacity), SETTLE).toBe(1)
    expect(await picker.count()).toBe(1)
    if (cell.action === 'dismiss-before-card') {
      await page.keyboard.press('Escape')
      await expectAbsent(picker, { provenBy: pickerProof, message: 'Esc before the card exists closes the picker' })
    }

    await harness('releaseCapacity')
    // 导入建卡：新卡被选中（导入的默认选中），正在拷文件（停在落盘那道闸上）。
    await expect.poll(() => harness('calls').then((calls) => calls.importFile), SETTLE).toBe(1)
    const building = await harness('snapshot')
    const cards = building.nodes.filter((node) => node.kind === 'asset')
    expect(cards).toHaveLength(1)
    const cardId = cards[0].id
    expect(building.selected).toEqual([cardId])
    if (cell.host === 'canvas') {
      // 这一类的前提真走到了：生成框随选中卸载（选择器跟着它一起没了）。
      await expectAbsent(composer, { provenBy: composerProof, message: 'the import selects the new card, so the canvas composer unmounts' })
    } else {
      expect(await picker.count()).toBe(1)
    }
    if (cell.action === 'dismiss-after-card') {
      await page.keyboard.press('Escape')
      await expectAbsent(picker, { provenBy: pickerProof, message: 'Esc after the card exists closes the picker' })
    }
    if (cell.action === 'select-other') await harness('select', 'other')

    await harness('releaseUpload')
    // 落盘回执写回卡上之后，接线与还选中都在同一串微任务里；下一次取快照已经在它们之后。
    await expect.poll(() => harness('snapshot').then((state) => state.nodes.find((node) => node.id === cardId)?.uploadStatus), SETTLE).toBe('uploaded')
    const done = await harness('snapshot')
    if (cell.outcome === 'card-only') {
      expect(done.edges).toEqual([])
      expect(done.selected).toEqual([cardId])
      expect(done.targetMode).toBe('t2i')
      return
    }
    expect(done.edges).toEqual([{ source: cardId, target: 'target' }])
    // 生成方式按现有接线规则走：文字生图升到收参考图的那一种。
    expect(done.targetMode).not.toBe('t2i')
    expect(done.selected).toEqual([cell.action === 'select-other' ? 'other' : 'target'])
    if (cell.action === 'select-other') return
    // 选中回到这张卡：生成框（重新）挂着，参考行里就是这张图。
    await expect.poll(() => composer.locator('[data-asset-tile]').count(), SETTLE).toBe(1)
    // 上传 + 接线是一个撤销点：撤一次，素材卡和边一起没了，方式回到文字生图。
    await harness('undo')
    const undone = await harness('snapshot')
    expect(undone.nodes.map((node) => node.id)).toEqual(['target', 'other'])
    expect(undone.edges).toEqual([])
    expect(undone.targetMode).toBe('t2i')
  } finally {
    await page.close()
  }
})
