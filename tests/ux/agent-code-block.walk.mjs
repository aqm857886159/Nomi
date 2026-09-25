// Agent 回复里的代码块 R13 走查（用户 2026-09-25：「粘贴框设计有问题吧，为什么这么丑」）。
// 用法: NOMI_EVIDENCE_LABEL=before|after node tests/ux/agent-code-block.walk.mjs（缺省 after）
// 产出: docs/evidence/2026-09-25-agent-panel-tidy/code-block-<label>-<zh|en>.png + code-block-<label>.json
//
// 真 app、真 Agent 面板、真出站请求：loopback 模型按用户截图那样回一段「中文版 / 英文版提示词 + 一段 JSON 参数」。
// 量的是用户说的四件事，全部读 computed style / 几何，不靠截图猜：
//   ① 单层容器：代码块子树里带边框的盒子只有一个；
//   ② 自动换行：长提示词不横向截断（内容宽 ≤ 可视宽）；
//   ③ 字体按内容判：提示词（无语言标）走正文字体，JSON 仍等宽；
//   ④ 复制键小、贴在容器右上角。
// NOMI_EVIDENCE_LABEL=before 跑在修复前的构建上：截图与观测照常落盘，断言红 = 复现证据。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertMockupContract, clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'
// 获批样张（2026-09-25「设计没问题」）的意图契约：无语言标题行、24px 复制钮、提示词正文字体 / JSON 等宽。
import codeBlockIntentContract from '../../docs/design/mockups/contracts/2026-09-25-agent-panel-tidy-code-block.intent.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { ASSISTANT_MESSAGE, CREATION_PANEL, DOCUMENT, chooseAssistantModel, createRuntimeWalk, recorded, sendCreation, waitForV4TurnIdle } from './agent-runtime-walk-support.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 标签走环境变量：runtime walk 的启动器只认 `--packaged <path>` 一种参数。
const label = process.env.NOMI_EVIDENCE_LABEL || 'after'
if (!['before', 'after'].includes(label)) throw new Error('Usage: NOMI_EVIDENCE_LABEL=before|after node tests/ux/agent-code-block.walk.mjs')
const outDir = path.join(repoRoot, 'docs/evidence/2026-09-25-agent-panel-tidy')
fs.mkdirSync(outDir, { recursive: true })

const PROMPT_EN = 'A cozy vintage camera shop at dawn, warm golden light slanting through the display window, dust motes floating in the air, shelves lined with film cameras and lenses, a small deer figurine on the counter, cinematic composition, 35mm film grain, shallow depth of field, soft shadows, photorealistic, 16:9'
const REPLY = [
  '可以，这是给生图模型的提示词。',
  '',
  '中文版：',
  '',
  '```',
  '清晨的老相机店，暖金色的光从橱窗斜照进来，空气里飘着细小的灰尘，货架上摆满胶片相机和镜头，柜台上一只小鹿摆件，电影感构图，35mm 胶片颗粒，浅景深。',
  '```',
  '',
  '英文版（如果用的模型更吃英文）：',
  '',
  '```',
  PROMPT_EN,
  '```',
  '',
  '批量生成时的参数：',
  '',
  '```json',
  '{ "aspect_ratio": "16:9", "style": "cinematic", "negative_prompt": "text, watermark, low quality, blurry, extra fingers" }',
  '```',
].join('\n')

/** 每个代码块的几何与样式：只在这条回复的子树里读。 */
async function observe(message) {
  return await message.evaluate((root) => {
    const bordered = (element) => {
      const style = getComputedStyle(element)
      return ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== 'none')
    }
    return [...root.querySelectorAll('[data-streamdown="code-block"]')].map((block) => {
      const pre = block.querySelector('pre')
      const body = block.querySelector('[data-streamdown="code-block-body"]')
      // 量用户看见的那颗：复制键外面 Streamdown 还包了一圈带边框的动作条，眼睛看到的「按钮」是它。
      const copy = block.querySelector('[data-streamdown="code-block-actions"]') ?? block.querySelector('[data-streamdown="code-block-copy-button"]')
      const blockBox = block.getBoundingClientRect()
      const copyBox = copy?.getBoundingClientRect()
      return {
        language: block.getAttribute('data-language'),
        text: (pre?.innerText ?? '').slice(0, 60),
        borderedBoxes: [block, ...block.querySelectorAll('*')].filter(bordered).length,
        overflowX: Math.max((body?.scrollWidth ?? 0) - (body?.clientWidth ?? 0), (pre?.scrollWidth ?? 0) - (pre?.clientWidth ?? 0)),
        whiteSpace: pre ? getComputedStyle(pre).whiteSpace : null,
        fontFamily: pre ? getComputedStyle(pre.querySelector('code') ?? pre).fontFamily : null,
        copy: copyBox ? {
          width: Math.round(copyBox.width), height: Math.round(copyBox.height),
          fromRight: Math.round(blockBox.right - copyBox.right), fromTop: Math.round(copyBox.top - blockBox.top),
        } : null,
      }
    })
  })
}

async function switchToEnglish(win) {
  await clickOrFail(win.getByRole('button', { name: /^(设置|Settings)$/ }).first(), '顶栏「设置」按钮')
  await clickOrFail(win.locator('[data-settings-tab-id="general"]'), '设置导航「通用」')
  await clickOrFail(win.locator('[data-settings-locale="en"]'), '语言切到 English')
  await expectVisible(win.locator('[data-settings-locale="en"][aria-pressed="true"]'), '语言分段控件已选中 English')
  await clickOrFail(win.locator('[data-settings-close]'), '关闭设置')
}

const walk = await createRuntimeWalk('agent-code-block')
const evidence = { label, observations: {} }
let failure
try {
  const { win } = await walk.start({ first: true })
  await walk.newProject()
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  await win.keyboard.press('Escape')
  await win.locator(DOCUMENT).click()
  const ask = '帮我写一段相机店清晨的生图提示词，中英文各一版'
  const reply = walk.fixture.expectText({ label: 'prompt reply', match: (body) => flattenRequestText(body).includes(ask), reply: { type: 'text', text: REPLY } })
  await sendCreation(win, ask)
  await recorded(reply.received, 'prompt reply request')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: win.getByText('英文版（如果用的模型更吃英文）：', { exact: true }) })
  const message = win.locator(`${CREATION_PANEL} ${ASSISTANT_MESSAGE}`).filter({ hasText: '英文版（如果用的模型更吃英文）：' }).last()
  await expect(message.locator('[data-streamdown="code-block"]')).toHaveCount(3)

  for (const locale of ['zh', 'en']) {
    if (locale === 'en') await switchToEnglish(win)
    await message.scrollIntoViewIfNeeded()
    await screenshotSettled(message, { path: path.join(outDir, `code-block-${label}-${locale}.png`) })
    evidence.observations[locale] = await observe(message)
    if (label === 'after') await assertMockupContract(win, codeBlockIntentContract)
  }
  fs.writeFileSync(path.join(outDir, `code-block-${label}.json`), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')

  for (const [locale, blocks] of Object.entries(evidence.observations)) {
    const [zhPrompt, enPrompt, json] = blocks
    for (const block of blocks) {
      expect(block.borderedBoxes, `[${locale}] 「${block.text}」应当只有一层带边框的容器`).toBe(1)
      expect(block.overflowX, `[${locale}] 「${block.text}」不该横向截断（应自动换行）`).toBeLessThanOrEqual(1)
      expect(block.copy, `[${locale}] 「${block.text}」有复制键`).toBeTruthy()
      expect(block.copy.width, `[${locale}] 复制键要小`).toBeLessThanOrEqual(24)
      expect(block.copy.height, `[${locale}] 复制键要小`).toBeLessThanOrEqual(24)
      expect(block.copy.fromRight, `[${locale}] 复制键贴容器右边`).toBeLessThanOrEqual(8)
      expect(block.copy.fromTop, `[${locale}] 复制键贴容器上边`).toBeLessThanOrEqual(8)
    }
    for (const prose of [zhPrompt, enPrompt]) {
      expect(prose.fontFamily, `[${locale}] 提示词不该用等宽字体`).not.toMatch(/mono/i)
    }
    expect(json.fontFamily, `[${locale}] 真正的代码（JSON）仍然等宽`).toMatch(/mono/i)
  }
  console.log(`✅ agent-code-block (${label}) —— 证据：${path.relative(repoRoot, outDir)}`)
} catch (error) {
  failure = error
  fs.writeFileSync(path.join(outDir, `code-block-${label}.json`), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.error(`❌ agent-code-block (${label})：${error instanceof Error ? error.message : String(error)}`)
} finally {
  await walk.finish(failure)
}
if (failure) process.exit(1)
