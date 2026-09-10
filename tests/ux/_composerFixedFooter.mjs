import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, screenshotSettled } from './_assert.mjs'

// All changes use UI actions; evaluate only reads layout and hit-test evidence.
export async function checkComposerFixedFooter(win, { composer, promptInput, flowNode, longPrompt, evidenceDir }) {
  const dir = path.join(evidenceDir, 'fixed-footer')
  mkdirSync(dir, { recursive: true })
  const evidence = []
  for (const state of ['short', 'long', 'cramped', 'narrow']) {
    const prompt = state === 'long' ? longPrompt : state === 'short' ? '一只猫坐在窗边，暖色自然光。' : ''
    if (state === 'cramped' || state === 'narrow') {
      await promptInput.click()
      await promptInput.press('ControlOrMeta+A')
      await promptInput.press('Backspace')
    } else await promptInput.fill(prompt)
    await expect(promptInput).toHaveText(prompt, { useInnerText: true })
    if (state === 'cramped' || state === 'narrow') await expect(composer.locator('[data-node-effect-chips]')).toHaveCount(1)
    if (state === 'narrow') {
      const before = await flowNode.boundingBox()
      const edge = flowNode.locator('.react-flow__resize-control.handle.bottom.right')
      const box = await edge.boundingBox()
      if (!box || !before) throw new Error('窄节点验收缺少真实 resize handle')
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await win.mouse.down()
      await win.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2 - 100, { steps: 12 })
      await win.mouse.up()
      await expect.poll(async () => (await flowNode.boundingBox())?.width).toBeLessThan(before.width)
    }
    for (const scheme of ['light', 'dark']) {
      if (await win.locator('html').getAttribute('data-mantine-color-scheme') !== scheme) {
        await win.getByRole('button', { name: '设置', exact: true }).click()
        await win.locator('[data-settings-tab-id="general"]').click()
        await win.getByRole('button', { name: scheme === 'light' ? '切换到浅色模式' : '切换到深色模式', exact: true }).click()
        await win.locator('[data-settings-close]').click()
      }
      const read = () => composer.evaluate(card => {
        const prompt = card.querySelector('[data-prompt-box]')?.parentElement
        const button = card.querySelector('button[aria-label="生成素材"],button[aria-label="重新生成"]')
        const more = card.querySelector('[data-effect-more]')
        const hit = element => {
          const rect = element.getBoundingClientRect()
          const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return Boolean(target && element.contains(target))
        }
        const row = card.querySelector('[data-node-effect-chips]')
        const chips = [...card.querySelectorAll('[data-effect-chip]')].filter(chip => getComputedStyle(chip).visibility !== 'hidden')
        return {
          promptHeight: prompt?.clientHeight ?? 0,
          promptScrolls: Boolean(prompt && prompt.scrollHeight > prompt.clientHeight),
          outerOverflow: getComputedStyle(card).overflowY,
          outerScrollTop: card.scrollTop,
          generateHit: Boolean(button && hit(button)), moreHit: Boolean(more && hit(more)),
          rowHeight: row?.clientHeight ?? 0, visibleChips: chips.length,
          chipsHit: chips.every(hit),
          card: { width: card.clientWidth, height: card.clientHeight },
        }
      })
      await expect.poll(async () => {
        const value = await read()
        return value.promptHeight >= 72 && value.outerOverflow === 'hidden' && value.outerScrollTop === 0 && value.generateHit && value.moreHit && value.rowHeight <= 24 && (value.rowHeight >= 24 || value.visibleChips === 0) && value.chipsHit && (state !== 'long' || value.promptScrolls)
      }, { message: `${state}/${scheme}: 输入内滚、底栏可点、推荐行最多一行` }).toBe(true)
      await composer.locator('[data-effect-more]').click()
      await expect(win.getByTestId('node-effect-menu')).toBeVisible()
      await win.keyboard.press('Escape')
      const value = await read()
      evidence.push({ state, scheme, nodeWidth: (await flowNode.boundingBox())?.width, ...value })
      await screenshotSettled(win, { path: path.join(dir, `${state}-${scheme}.png`) })
      console.log('FIXED_FOOTER', JSON.stringify(evidence.at(-1)))
    }
  }
  writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify(evidence, null, 2))
}

export async function expectComposerFooterHit(composer, label) {
  await expect.poll(() => composer.evaluate(card => {
    const button = card.querySelector('button[aria-label="生成素材"],button[aria-label="重新生成"]')
    const rect = button?.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const target = rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return Boolean(button && target && button.contains(target) && rect.bottom <= cardRect.bottom && card.scrollTop === 0)
  }), { message: `${label}: 点击前底栏必须已可见且命中，不能靠自动滚卡修正` }).toBe(true)
}
