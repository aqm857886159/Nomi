// Real Electron journey: only UI actions create projects, nodes and prompt presets.
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectOverlayReachable, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { addCanvasNode, canvasZoomStep, closeRailDrawer, collapseAgentPanel, ensureAgentPanelOpen, newProjectEntry, openRailDrawer, openSettings } from './_shell.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

const before = process.argv.includes('--before')
const output = assertOutsideRepo(makeTempDir('nomi-node-prompt-presets-evidence-'))
process.env.EVIDENCE_DIR = output
const run = await launchNomiApp({ name: 'node-prompt-presets', settleMs: 0,
  initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
})
const page = run.win
page.setDefaultTimeout(stationTimeout({ operations: 2 }))
const picker = () => page.getByTestId('node-prompt-presets')
const search = () => picker().locator('[data-library-search]')
const nodes = page.locator('.generation-canvas-v2-node[data-node-id]')
let selectedNode
const composer = () => selectedNode.locator('.generation-canvas-v2-node__composer')
const editor = () => composer().locator('[data-node-composer-prompt] [data-prompt-box] [contenteditable="true"]')
const presetTrigger = () => composer().locator('[data-prompt-tool="effects"]')

async function addNode(kind) {
  const readIds = () => nodes.evaluateAll(elements => elements.map(el => el.getAttribute('data-node-id')))
  const previousIds = await readIds()
  await addCanvasNode(page, kind)
  await expect(nodes).toHaveCount(previousIds.length + 1)
  const [id] = (await readIds()).filter(id => !previousIds.includes(id))
  selectedNode = nodes.and(page.locator(`[data-node-id="${id}"]`))
  await expect(selectedNode).toHaveAttribute('data-selected', 'true')
  await expect(editor()).toBeVisible()
}
async function openPicker() {
  // 点画布空白和切换抽屉都可能结束节点选择。重新选中同一个节点再开预设。
  if (await selectedNode.getAttribute('data-selected') !== 'true') {
    await selectedNode.click({ position: { x: 8, y: 8 } })
  }
  const trigger = presetTrigger()
  await expect(trigger).toBeVisible()
  for (let step = 0; step < 6; step += 1) {
    if (await trigger.click({ trial: true, timeout: 650 }).then(() => true, () => false)) break
    await canvasZoomStep(page, 'out', '缩小画布露出节点底栏')
  }
  await trigger.click()
  await expect(picker()).toBeVisible()
}
async function verifySupplemental() {
  await search().fill('e-commerce')
  const publicRow = picker().locator('[data-library-option]').first()
  await expect(publicRow).toBeVisible()
  const publicPrompt = await publicRow.locator('span.block').last().textContent()
  expect(publicPrompt.length).toBeGreaterThan(40)
  await publicRow.click()
  await expect(editor()).toContainText(publicPrompt.slice(0, 80))
  await page.getByRole('button', { name: '撤销', exact: true }).last().click()
  await expect(editor()).toHaveText('')
  await openPicker()
  await search().fill('人物三视图')
  const effect = picker().locator('[data-library-option="effect-character-three-view"]')
  await effect.hover()
  const preview = page.locator('[data-prompt-preview="effect-character-three-view"]').first()
  await expect(preview).toBeVisible()
  // A real image must decode; if its remote source fails, the real fallback must replace it.
  await expect.poll(async () => preview.evaluate(el => {
    const img = el.querySelector('img')
    return Boolean(img ? img.complete && img.naturalWidth > 0 : el.querySelector('[data-skill-media="placeholder"]'))
  }), { timeout: stationTimeout({ operations: 2 }), message: '效果真实配图解码或明确显示提示词占位图标' }).toBe(true)
  const media = await preview.evaluate(el => ({
    decodedImage: Boolean(el.querySelector('img')?.naturalWidth),
    promptFallback: Boolean(el.querySelector('[data-skill-media="placeholder"] svg.tabler-icon-file-text')),
  }))
  await page.screenshot({ path: path.join(output, 'after-effect-media-preview.png') })
  await presetTrigger().click()
  fs.writeFileSync(path.join(output, 'supplemental.json'), JSON.stringify({ passed: true, publicPromptApplied: true, media, faultInjection: 'not performed; IPC ok:false behavior covered by API unit tests', paidCalls: 0 }, null, 2))
  await openPicker()

}
async function createPersonalPrompt(kind, title, prompt) {
  const panel = await openRailDrawer(page, 'prompts', '侧栏「提示词库」')
  // 2026-10-24 改版：「新建」在抽屉标题行（点了切到「我的」+ 内联表单），来源分段删了。
  await page.locator('[data-shell-drawer="prompts"] header [data-prompt-new]').click()
  await panel.getByPlaceholder('标题（选填，如「黄昏剪影」）').fill(title)
  await panel.getByPlaceholder('把验证过好用的提示词粘进来…').fill(prompt)
  await panel.getByRole('tablist', { name: '提示词类型', exact: true }).getByRole('tab', { name: kind === 'image' ? '图片' : '视频', exact: true }).click()
  await panel.getByRole('button', { name: '保存到库', exact: true }).click()
  await expect(panel.getByPlaceholder('把验证过好用的提示词粘进来…')).toBeHidden()
  await closeRailDrawer(page, 'prompts', '收起提示词抽屉')
}
try {
  const window = await run.app.browserWindow(page)
  await window.evaluate(w => w.setBounds({ x: 0, y: 0, width: 1680, height: 1050 }))
  await newProjectEntry(page).click()
  await page.getByRole('button', { name: '生成', exact: true }).first().click()
  await addNode('image')
  await openPicker()
  if (before) {
    await expect(page.getByTestId('node-effect-menu')).toBeVisible()
    await page.screenshot({ path: path.join(output, 'before-zh-light.png') })
    fs.writeFileSync(path.join(output, 'before.json'), JSON.stringify({ captured: true, ordinaryPublicRows: await page.getByTestId('node-effect-menu').getByText('GPT Image 2', { exact: false }).count() }, null, 2))
  } else {
    await expect(picker()).toBeVisible()
    await verifySupplemental()
    if (!process.argv.includes('--supplemental')) {
      await expectOverlayReachable(picker(), '节点预设浮层')
      await search().fill('e-commerce')
      await expect(picker().locator('[data-library-option]').first()).toBeVisible()
      const optionProof = await proveProbe(picker().locator('[data-library-option]'), '公共提示词搜索实际返回选项')
      await page.screenshot({ path: path.join(output, 'after-public-search-zh-light.png') })
      await search().fill('no-such-preset-89133771')
      await expectAbsent(picker().locator('[data-library-option]'), { provenBy: optionProof, message: '查询或媒介不匹配时不显示预设' })
      await page.screenshot({ path: path.join(output, 'after-empty-zh-light.png') })
      await page.keyboard.press('Escape')
      await expect(picker()).toBeHidden()
      await editor().fill('保留原来的主体描述')
      await openPicker()
      await search().fill('人物三视图')
      await picker().locator('[data-library-option="effect-character-three-view"]').click()
      await expect(editor()).toContainText('保留原来的主体描述')
      await expect(editor()).toContainText('三格人物等高')
      await page.getByRole('button', { name: '撤销', exact: true }).last().click()
      await expect(editor()).toHaveText('保留原来的主体描述')
      await openPicker()
      const blank = await findCanvasBlankPoint(page)
      expect(blank, '预设之外有可点击的画布空白').toBeTruthy()
      await page.mouse.click(blank.x, blank.y)
      await expect(picker()).toBeHidden()
      // Mount/cache the picker before using the separate real library editor.
      await createPersonalPrompt('image', '预设回归图片', '晨光中的红色玻璃杯，柔和阴影。')
      await openPicker()
      await search().fill('预设回归图片')
      await expect(picker().locator('[data-library-option]')).toHaveCount(1)
      await page.screenshot({ path: path.join(output, 'after-personal-refresh-zh-light.png') })
      await picker().locator('[data-library-option]').click()
      await expect(editor()).toContainText('晨光中的红色玻璃杯')
      await createPersonalPrompt('video', '预设回归视频', '镜头缓慢推近，雨滴沿玻璃落下。')
      await openPicker()
      await search().fill('预设回归视频')
      await expectAbsent(picker().locator('[data-library-option]'), { provenBy: optionProof, message: '查询或媒介不匹配时不显示预设' })
      await page.keyboard.press('Escape')
      await addNode('video')
      await openPicker()
      await search().fill('预设回归视频')
      await expect(picker().locator('[data-library-option]')).toHaveCount(1)
      await picker().locator('[data-library-option]').click()
      await expect(editor()).toContainText('镜头缓慢推近')
      await openPicker()
      await search().fill('预设回归图片')
      await expectAbsent(picker().locator('[data-library-option]'), { provenBy: optionProof, message: '查询或媒介不匹配时不显示预设' })
      await page.keyboard.press('Escape')
      await ensureAgentPanelOpen(page, '打开 Agent 面板')
      await page.locator('[data-v4-control="skill"]').first().click()
      const agentPicker = page.locator('[data-v4-popover="skill"]').first()
      await agentPicker.locator('[data-v4-control="skill-search"]').fill('多视图')
      await expect(agentPicker.locator('[data-v4-command="skill:curated-multi-view"]')).toBeVisible()
      await agentPicker.locator('[data-v4-command="skill:curated-multi-view"]').hover()
      await expect(page.locator('[data-skill-hover="skill:curated-multi-view"]').first()).toBeVisible()
      await page.screenshot({ path: path.join(output, 'after-agent-skill-shared-picker.png') })
      await agentPicker.locator('[data-v4-command="skill:curated-multi-view"]').click()
      await expect(page.locator('[data-v4-chip="skill"]').first()).toContainText('多视图')
      await collapseAgentPanel(page, '完成 Agent 预设检查后收起面板')
      // Change appearance through the same Settings controls a user uses, without reloading the project.
      for (const [locale, theme] of [['zh-CN', 'dark'], ['en', 'light'], ['en', 'dark']]) {
        await openSettings(page, { tab: 'general' })
        await page.locator(`[data-settings-locale="${locale}"]`).click()
        const currentTheme = await page.locator('html').getAttribute('data-mantine-color-scheme')
        if (currentTheme !== theme) await page.getByRole('button', { name: /切换到.*模式|Switch to .* mode/ }).click()
        await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', theme)
        await page.keyboard.press('Escape')
        await expect(page.locator('[data-settings-dialog]')).toBeHidden()
        await openPicker()
        await search().fill('预设回归视频')
        await expect(picker().locator('[data-library-option]')).toHaveCount(1)
        await page.screenshot({ path: path.join(output, `after-${locale}-${theme}.png`) })
        await page.keyboard.press('Escape')
      }
      const tasks = ['ordinary public presets', 'search and empty results', 'append and undo', 'real personal image/video creation', 'refresh existing picker', 'image/video filtering', 'Escape and outside click', 'zh/en light/dark', 'Agent shared picker search/preview/selection']
      fs.writeFileSync(path.join(output, 'journey.json'), JSON.stringify({ passed: true, paidCalls: 0, tasks }, null, 2))
      console.log(`PASS ${tasks.length}/${tasks.length} prompt preset scenarios`)
    }
  }
} catch (error) {
  await page.screenshot({ path: path.join(output, before ? 'before-FAIL.png' : 'after-FAIL.png') })
  console.error((await page.locator('body').innerText()).slice(-6500))
  throw error
} finally { await run.close() }
