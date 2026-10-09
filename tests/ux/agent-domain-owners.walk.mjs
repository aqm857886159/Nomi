#!/usr/bin/env node
// 验收走查 · Agent 三件事各回到自己的主人那一层（测试表 1-10 行）
//
//   ① 附件：发出去那条消息还带着附件；Agent 读到了文件里那句暗号；重开项目历史里还在。
//   ② 默认模型：设置里的「图片默认 / 视频默认」——没点名就是默认；点名听用户；换了要说清且卡上是换后的。
//   ③ 分镜表：Agent 新建分镜方案不替用户打开；用户自己点开正常打开。
//
// 真 Electron、真 IPC、真渲染层；只有文本模型是夹具里的「守规矩的模型」（它读宿主递给它的东西再出牌，
// 被测的是宿主递了什么、界面落了什么，不是它的话术）。零花费。
//
// 跑法（先 pnpm run build）：
//   NOMI_CORE_SMOKE_FIXTURE=empty|used NOMI_FULL_WALK_LOCALE=zh-CN|en node tests/ux/agent-domain-owners.walk.mjs
// 每一行的结论与截图落在 <outputDir>/rows.json，验收页从它生成。
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  ASSISTANT_MESSAGE, APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_ADD_FILE, COMPOSER_CHIP, COMPOSER_MODEL, CREATION_PANEL, MODEL_POPOVER, USER_BUBBLE,
  closeSpendCard, expandResidentPanel, sendCanvas, sendCreation,
} from './agent-runtime-walk-support.mjs'
import { lastUserText, operationIdOf, scriptTurn } from './full-walk/brain.mjs'
import { startPlaybook } from './full-walk/launch.mjs'
import { backToLibrary } from './_shell.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const pb = await startPlaybook({
  id: 'agent-domain-owners',
  needs: ['loopbackProvider', 'fixtureTextModel', 'paidGenerationRoute'],
  seed: () => ({ nodes: [], groups: [], edges: [] }),
})
const { smoke, fixture, outputDir } = pb
const EN = pb.locale === 'en'
const win = () => smoke.win
const FIXTURE_KIND = process.env.NOMI_CORE_SMOKE_FIXTURE || 'empty'
const rows = []

const IMAGE_DEFAULT = { vendorKey: FIXTURE_APIMART_VENDOR, modelKey: 'gemini-3.1-flash-image-preview', option: /^Nano Banana 2(\s|$|·)/ }
const IMAGE_NAMED = { modelKey: 'gpt-image-2', label: 'GPT Image 2' }
const VIDEO_DEFAULT = { vendorKey: FIXTURE_APIMART_VENDOR, modelKey: 'kling-v3', option: /^(可灵 3\.0|Kling 3\.0)(\s|$|·)/ }
// 暗号跟界面语言走：英文界面里不该出现中文，哪怕是走查自己种的文件内容（它会被 Agent 原样复述进对话）。
const MARKER_TEXT = EN ? 'ACCEPT-MARK lamp-8842' : '【验收暗句：栈桥尽头的灯-8842】'
const DOMAIN_FILE = path.join(outputDir, EN ? 'harbour-note.txt' : '海港便笺.txt')
fs.writeFileSync(DOMAIN_FILE, `${MARKER_TEXT}\n${EN ? 'The lamp at the end of the pier stays lit all night.' : '栈桥尽头的那盏灯整夜亮着。'}\n`)
const FILE_NAME = path.basename(DOMAIN_FILE)

let shotIndex = 0
async function shot(label) {
  shotIndex += 1
  const file = path.join(outputDir, `${String(shotIndex).padStart(2, '0')}-${label}.png`)
  await win().screenshot({ path: file })
  return path.relative(outputDir, file).split(path.sep).join('/')
}

/** 一行测试：跑、记结论与截图；一行红了不拖垮后面的行（每行自己的现场自己收）。 */
async function row(id, title, expected, body) {
  const record = { id, title, expected, fixture: FIXTURE_KIND, locale: pb.locale, result: 'fail', detail: '', screenshots: [] }
  try {
    const detail = await body(record)
    record.result = 'pass'
    record.detail = detail ?? ''
  } catch (error) {
    record.detail = String(error?.message ?? error).split('\n').slice(0, 6).join(' ')
    record.screenshots.push(await shot(`${id}-FAIL`).catch(() => ''))
    console.error(`[domain-walk] ${id} 不通过：${record.detail}`)
  }
  rows.push(record)
  fs.writeFileSync(path.join(outputDir, 'rows.json'), JSON.stringify(rows, null, 2))
}

const spendCard = (panel) => win().locator(`${panel} ${APPROVAL_CARD}[data-kind="spend"]`)

async function pickDefault(rowLabel, spec) {
  await clickOrFail(win().locator(`${CANVAS_PANEL} ${COMPOSER_MODEL}`), 'Agent 模型选择器')
  const popover = win().locator(`${CANVAS_PANEL} ${MODEL_POPOVER}`)
  await expect(popover).toBeVisible()
  const line = popover.locator(`[data-v4-model-row="${rowLabel}"]`)
  await clickOrFail(line.locator('button').first(), `「${rowLabel}」那一行的下拉`)
  const option = win().locator('[data-nomi-select-dropdown] [data-nomi-select-option-label]').filter({ hasText: spec.option }).first()
  const label = (await option.innerText()).trim()
  await clickOrFail(option, `下拉里的「${label}」`)
  await expect(line, `弹层那一行现在写着 ${label}`).toContainText(label.split(/\s·\s/)[0])
  await win().keyboard.press('Escape')
  return label
}

try {
  await pb.monitor.step('打开项目', () => smoke.openProject(), { surfaces: ['*'], critical: true })
  await pb.monitor.step('展开 Agent 面板', () => expandResidentPanel(win()), { surfaces: ['agentPanel', 'rightPanel'] })

  // ═══ ① 附件（行 1/2/3/4）═══════════════════════════════════════════════════════════════
  const summarizeTurn = scriptTurn(fixture, {
    label: 'dom-attachment', marker: 'DOM-ATT',
    steps: [{ text: ({ body }) => (flattenRequestText(body).includes(MARKER_TEXT)
      ? (EN ? `It says: ${MARKER_TEXT} The lamp at the end of the pier stays lit all night.` : `文件里写着：${MARKER_TEXT} 栈桥尽头的那盏灯整夜亮着。`)
      : (EN ? 'I cannot see any attachment content.' : '我没看到附件的内容。')) }],
  })
  await row('attach-send', EN ? 'Attach a txt, ask the Agent to summarize it' : '输入框附一个 txt，让 Agent「总结这个文件」',
    EN ? 'The sent message keeps the attachment chip; the answer quotes the sentence in the file' : '发出后这条消息还带着附件；Agent 的回答里提到了那句话', async (record) => {
      const chooser = win().waitForEvent('filechooser', { timeout: stationTimeout() })
      await clickOrFail(win().locator(`${CANVAS_PANEL} ${COMPOSER_ADD_FILE}`), '输入框的「+」（添加文件）')
      await (await chooser).setFiles(DOMAIN_FILE)
      await expect(win().locator(`${CANVAS_PANEL} ${COMPOSER} ${COMPOSER_CHIP}`).filter({ hasText: FILE_NAME.slice(0, 4) }), '输入框里挂上了附件签').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      const assetNames = () => (fs.existsSync(path.join(smoke.project.projectRoot, 'assets')) ? fs.readdirSync(path.join(smoke.project.projectRoot, 'assets'), { recursive: true }).map(String) : [])
      try {
        await expect.poll(() => assetNames().some((name) => name.endsWith('.txt')), { message: '附件落进了项目素材', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
      } catch (error) {
        throw new Error(`附件没落进项目素材（assets 里现有：${JSON.stringify(assetNames())}；项目里名字带 harbour/海港 的：${JSON.stringify(fs.readdirSync(smoke.project.projectRoot, { recursive: true }).map(String).filter((name) => /harbour|海港|\.txt$/i.test(name)))}；项目根：${smoke.project.projectRoot}）`, { cause: error })
      }
      record.screenshots.push(await shot('attach-composer'))
      await sendCanvas(win(), EN ? 'DOM-ATT: summarize this file for me.' : 'DOM-ATT：总结一下这个文件。')
      await summarizeTurn.done
      const bubble = win().locator(`${CANVAS_PANEL} ${USER_BUBBLE}`).last()
      await expect(bubble.locator('[data-v4-chip]').filter({ hasText: FILE_NAME.slice(0, 4) }), '发出后那条用户消息还带着附件签').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      await expect(win().locator(`${CANVAS_PANEL} ${ASSISTANT_MESSAGE}`).last(), 'Agent 的回答里有文件里那句暗号').toContainText(MARKER_TEXT, { timeout: DEFAULT_TIMEOUT_MS })
      const chipText = await bubble.locator('[data-v4-chip]').first().innerText()
      record.screenshots.push(await shot('attach-sent'))
      return `气泡里的签：「${chipText.trim()}」；回答含暗句`
    })

  await row('attach-reopen', EN ? 'Close the project, reopen, look at that message' : '关掉项目再打开，看那条历史消息', EN ? 'The attachment is still there' : '附件还在', async (record) => {
    // 回项目库再打开是用户的动作：项目库里没有工作区（workspaceMode 读成空），打开后回到生成页——整段声明成用户动作。
    await pb.monitor.step('用户：回项目库、再打开这个项目', async () => {
      await backToLibrary(win(), { label: '顶栏「项目库」' })
      await smoke.openProject()
      await expandResidentPanel(win())
    }, { surfaces: ['*'] })
    const bubble = win().locator(`${CANVAS_PANEL} ${USER_BUBBLE}`).filter({ hasText: /DOM-ATT/ }).last()
    await expect(bubble, '重开后历史里那条消息还在').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await expect(bubble.locator('[data-v4-chip]').filter({ hasText: FILE_NAME.slice(0, 4) }), '重开后那条历史消息还带着附件签').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    record.screenshots.push(await shot('attach-reopened'))
    return '重开项目后历史消息上仍有附件签'
  })

  // ═══ ② 默认模型（行 5/6/7/8）══════════════════════════════════════════════════════════
  // 守规矩的模型读索引里「图片默认（文生图）：显示名（modelId: X，vendor: 家——仅供工具参数）」那一行；读到就不点名、让宿主补。
  const toldDefault = (body, kind) => new RegExp(`${kind}[^\\n]*modelId: ([^，\\s)]+)，vendor: ${FIXTURE_APIMART_VENDOR}`).exec(flattenRequestText(body))?.[1] ?? null
  const cardText = async (panel = CANVAS_PANEL) => (await spendCard(panel).innerText()).replace(/\s+/g, ' ').trim()

  let imageLabel = ''
  await row('default-image', EN ? 'Image default = X, ask the Agent to draw, no model named' : '「图片默认」设成 X，让 Agent「画一张…」，不点名模型',
    EN ? 'The spend card shows X' : '付费卡上是 X', async (record) => {
      imageLabel = await pickDefault(EN ? 'Image default' : '图片默认', IMAGE_DEFAULT)
      // 守规矩的模型：宿主告诉了它「图片默认（文生图）：家/模型」就不点名、让宿主补；没告诉就按自己的偏好点名。
      const turn = scriptTurn(fixture, { label: 'dom-image-default', marker: 'DOM-IMG', steps: [
        { name: 'draft_shots', args: ({ body }) => ({ shots: [{ prompt: EN ? 'a red paper boat in a puddle' : '雨后水洼里的红色纸船', taskKind: 'text_to_image', parameters: { aspect_ratio: '1:1' },
          ...(toldDefault(body, '图片默认（文生图）') ? {} : { candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: IMAGE_NAMED.modelKey } }) }] }) },
        { name: 'generate', args: ({ previous }) => ({ operationId: operationIdOf(previous) }) },
        { text: EN ? 'The card is ready.' : '付费卡摆好了。' },
      ] })
      await sendCanvas(win(), EN ? 'DOM-IMG: draw me a red paper boat in a puddle.' : 'DOM-IMG：帮我画一张雨后水洼里的红色纸船。')
      await expect(spendCard(CANVAS_PANEL), '出现付费卡').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
      const text = await cardText()
      record.screenshots.push(await shot('default-image-card'))
      expect(text, `付费卡上写的是默认模型「${imageLabel}」`).toContain(imageLabel.split(/\s·\s/)[0])
      await closeSpendCard(spendCard(CANVAS_PANEL))
      await turn.done.catch(() => undefined)
      return `卡片：${text.slice(0, 120)}`
    })

  await row('default-video', EN ? 'Video default = Y, ask for a video' : '「视频默认」设成 Y，让 Agent 做一段视频', EN ? 'The spend card shows Y' : '付费卡上是 Y', async (record) => {
    const label = await pickDefault(EN ? 'Video default' : '视频默认', VIDEO_DEFAULT)
    const turn = scriptTurn(fixture, { label: 'dom-video-default', marker: 'DOM-VID', steps: [
      { name: 'draft_shots', args: ({ body }) => ({ shots: [{ prompt: EN ? 'boats rocking in the morning mist' : '清晨雾里小船轻轻摇晃', taskKind: 'text_to_video',
        ...(toldDefault(body, '视频默认（文生视频）') ? {} : { candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: 'seedance-2.0' } }) }] }) },
      { name: 'generate', args: ({ previous }) => ({ operationId: operationIdOf(previous) }) },
      { text: EN ? 'The card is ready.' : '付费卡摆好了。' },
    ] })
    await sendCanvas(win(), EN ? 'DOM-VID: make a short video of boats rocking in the morning mist.' : 'DOM-VID：做一段清晨雾里小船摇晃的视频。')
    await expect(spendCard(CANVAS_PANEL), '出现付费卡').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
    const text = await cardText()
    record.screenshots.push(await shot('default-video-card'))
    expect(text, `付费卡上写的是默认视频模型「${label}」`).toContain(label.split(/\s·\s/)[0])
    await closeSpendCard(spendCard(CANVAS_PANEL))
    await turn.done.catch(() => undefined)
    return `卡片：${text.slice(0, 120)}`
  })

  await row('default-named', EN ? 'Tell the Agent "draw this one with Z"' : '跟 Agent 说「这张用 Z 画」', EN ? 'The card shows Z' : '卡上是 Z', async (record) => {
    const turn = scriptTurn(fixture, { label: 'dom-image-named', marker: 'DOM-NAME', steps: [
      { name: 'draft_shots', args: { shots: [{ prompt: EN ? 'a lighthouse at dusk' : '黄昏的灯塔', taskKind: 'text_to_image', parameters: { aspect_ratio: '1:1' },
        candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: IMAGE_NAMED.modelKey } }] } },
      { name: 'generate', args: ({ previous }) => ({ operationId: operationIdOf(previous) }) },
      { text: EN ? 'The card is ready.' : '付费卡摆好了。' },
    ] })
    await sendCanvas(win(), EN ? `DOM-NAME: draw a lighthouse at dusk with ${IMAGE_NAMED.label}.` : `DOM-NAME：黄昏的灯塔，这张用 ${IMAGE_NAMED.label} 画。`)
    await expect(spendCard(CANVAS_PANEL), '出现付费卡').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
    const text = await cardText()
    record.screenshots.push(await shot('default-named-card'))
    expect(text, `付费卡上是用户点名的「${IMAGE_NAMED.label}」，不是默认的「${imageLabel}」`).toContain(IMAGE_NAMED.label)
    await closeSpendCard(spendCard(CANVAS_PANEL))
    await turn.done.catch(() => undefined)
    return `卡片：${text.slice(0, 120)}`
  })

  await row('default-switch', EN ? 'Ask for something the default model cannot do' : '让 Agent 做一件默认模型做不了的事',
    EN ? 'The Agent first says why it switched and to whom; the card shows the switched model' : 'Agent 先说为什么换、换成谁；卡上是换后的模型', async (record) => {
      const seen = {}
      const turn = scriptTurn(fixture, { label: 'dom-image-switch', marker: 'DOM-SWITCH', steps: [
        // 默认（Nano Banana 2）做不了「多图参考」这件事，模型改用另一个：这一步宿主会把「和用户默认不一致」作为事实递回来。
        { name: 'draft_shots', args: { shots: [{ prompt: EN ? 'merge these two harbour photos' : '把这两张海港照片合成一张', taskKind: 'text_to_image', parameters: { aspect_ratio: '1:1' },
          candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: IMAGE_NAMED.modelKey } }] } },
        // 先说为什么换、换成谁——话里的模型名读宿主递回来的偏离事实，不是脚本写死的。
        { name: 'generate', text: ({ previous }) => {
          // 对用户说话只用宿主递回来的**显示名**（和卡上、设置里同一个名字），不念 id。
          const fact = /"modelDeviatesFromUserDefault":\[\{[^\]]*"used":"([^"]+)","userDefaultName":"([^"]+)","usedName":"([^"]+)"/.exec(String(previous ?? ''))
          seen.fact = fact ? { used: fact[1], userDefaultName: fact[2], usedName: fact[3] } : null
          return fact ? (EN ? `Your default ${fact[2]} can't take two reference images, so I switched to ${fact[3]}.` : `你设的默认 ${fact[2]} 做不了多图合成，这次换成 ${fact[3]}。`)
            : (EN ? 'Using the default.' : '用默认的。')
        }, args: ({ previous }) => ({ operationId: operationIdOf(previous) }) },
        { text: EN ? 'The card is ready.' : '付费卡摆好了。' },
      ] })
      await sendCanvas(win(), EN ? 'DOM-SWITCH: merge these two harbour photos into one.' : 'DOM-SWITCH：把这两张海港照片合成一张。')
      await expect(spendCard(CANVAS_PANEL), '出现付费卡').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
      const text = await cardText()
      const said = await win().locator(`${CANVAS_PANEL} ${ASSISTANT_MESSAGE}`).last().innerText()
      record.screenshots.push(await shot('default-switch-card'))
      expect(seen.fact, '宿主把「实际用的 ≠ 用户默认」作为事实递给了 Agent').toBeTruthy()
      expect(seen.fact.used).toContain(IMAGE_NAMED.modelKey)
      expect(said, 'Agent 的话里说了默认是谁（显示名）').toContain(seen.fact.userDefaultName)
      expect(said, 'Agent 的话里说了换成谁（显示名）').toContain(seen.fact.usedName)
      // 显示名就是卡上那个名字；话里不许出现 id（供应商 / 模型 id）。
      const idsSpoken = /apimart\/|gpt-image-2|gemini-3\.1-flash-image-preview/.test(said)
      expect(idsSpoken, `话里没有念 id：${said.slice(0, 120)}`).toBe(false)
      expect(seen.fact.usedName, '显示名与卡上写的是同一个').toBe(IMAGE_NAMED.label)
      expect(text, '付费卡上是换后的模型').toContain(IMAGE_NAMED.label)
      await closeSpendCard(spendCard(CANVAS_PANEL))
      await turn.done.catch(() => undefined)
      return `事实：${JSON.stringify(seen.fact)}；话：${said.slice(0, 100)}；卡片：${text.slice(0, 80)}`
    })

  // ═══ ③ 分镜表（行 9/10）══════════════════════════════════════════════════════════════
  await pb.monitor.step('切到创作页', async () => {
    await clickOrFail(win().locator('.nomi-stepper__step[data-mode="creation"]').first(), '顶栏「创作」')
    await expandResidentPanel(win())
    await expect(win().locator(`${CREATION_PANEL} ${COMPOSER}`)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  }, { surfaces: ['workspaceMode', 'agentPanel', 'rightPanel', 'canvasViewport', 'creationSelection'] })
  const SHOTS = EN ? ['Morning harbour in the mist', 'A cat on the pier', 'Seagulls past the masts'] : ['清晨的渔港，雾里的小船', '码头上晒太阳的猫', '海鸥掠过桅杆']
  await row('storyboard-button', EN ? 'Select text in the document, click "Split into shots"' : '在文稿里选中文字，点「拆成镜头」', EN ? 'The new plan opens by itself (the user did it); a plan the Agent decides to create does not (next row)' : '新方案自动打开（是用户亲手点的）；Agent 自己决定建的方案不打开（见下一行）', async (record) => {
    const listState = () => win().evaluate(() => ({ ids: [...document.querySelectorAll('[data-storyboard-id]')].map((element) => element.getAttribute('data-storyboard-id')), active: [...document.querySelectorAll('[data-storyboard-id][data-active="true"]')].map((element) => element.getAttribute('data-storyboard-id')) }))
    const before = await listState()
    const turn = scriptTurn(fixture, { label: 'dom-storyboard-button', marker: 'DOM-BTN', steps: [
      { name: 'draft_shots', args: { shots: SHOTS.map((prompt, index) => ({ title: `${EN ? 'Shot' : '镜头'} ${index + 1}`, prompt, taskKind: 'text_to_video',
        candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: 'kling-v3' } })) } },
      { text: EN ? 'The storyboard is written.' : '分镜写好了。' },
    ] })
    await pb.monitor.step('用户：选中文稿文字，点「拆成镜头」', async () => {
      const editor = win().locator('[aria-label="创作文档编辑区"] .tiptap[contenteditable="true"], .tiptap[contenteditable="true"]').first()
      await clickOrFail(editor, '文稿编辑区')
      // 文稿开头写一句带暗号的话（空资料里文稿本来是空的，选区要有字；暗号让「大脑」认得这一轮）。
      await win().keyboard.press('Control+Home')
      await win().keyboard.type(EN ? 'DOM-BTN: the harbour at dawn. ' : 'DOM-BTN：清晨的渔港。')
      await win().keyboard.press('Control+a')
      await clickOrFail(win().getByRole('button', { name: EN ? 'Split into shots' : '拆成镜头' }), '选区浮条上的「拆成镜头」')
      // 方案落地、被打开发生在这一下点击的结果里：等它落完才算这一步结束，界面的变化才算在用户这一步声明里。
      await turn.done
      await expect.poll(async () => (await listState()).ids.length, { message: '新方案进了左栏', timeout: DEFAULT_TIMEOUT_MS }).toBe(before.ids.length + 1)
    }, { surfaces: ['workspaceMode', 'agentPanel', 'rightPanel', 'canvasViewport', 'creationSelection', 'storyboardTable'] })
    const after = await listState()
    const created = after.ids.find((id) => !before.ids.includes(id))
    record.screenshots.push(await shot('storyboard-button-opened'))
    expect(after.active, '用户亲手点的：新方案被打开').toEqual([created])
    return `新方案 ${created} 已打开（打开的方案 前 ${JSON.stringify(before.active)} 后 ${JSON.stringify(after.active)}）`
  })

  await row('storyboard-not-opened', EN ? 'Ask the Agent to draft a multi-shot storyboard' : '让 Agent 起草多镜头分镜', EN ? 'The storyboard table does not open by itself; the Agent says it is written and where to open it' : '分镜表不会自己打开；Agent 说分镜写好了、在哪打开', async (record) => {
    const listState = () => win().evaluate(() => ({ ids: [...document.querySelectorAll('[data-storyboard-id]')].map((element) => element.getAttribute('data-storyboard-id')), active: [...document.querySelectorAll('[data-storyboard-id][data-active="true"]')].map((element) => element.getAttribute('data-storyboard-id')) }))
    const before = await listState()
    const turn = scriptTurn(fixture, { label: 'dom-storyboard', marker: 'DOM-SB', steps: [
      { name: 'draft_shots', args: { shots: SHOTS.map((prompt, index) => ({ title: `${EN ? 'Shot' : '镜头'} ${index + 1}`, prompt, taskKind: 'text_to_video',
        candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: 'kling-v3' } })) } },
      { text: ({ previous }) => {
        const saved = /"storyboardSaved":\{"designId":"([^"]+)","title":"([^"]*)","opened":false/.exec(String(previous ?? ''))
        return saved ? (EN ? `The storyboard "${saved[2]}" is written. It is in the left column under your document — click it to open.` : `分镜「${saved[2]}」写好了，在左栏原稿下面，点它就能打开。`)
          : (EN ? 'Done.' : '好了。')
      } },
    ] })
    await sendCreation(win(), EN ? 'DOM-SB: draft a three-shot storyboard: harbour, cat, gulls.' : 'DOM-SB：起草一份三镜头分镜：渔港、猫、海鸥。')
    await turn.done
    await expect(win().locator(`${CREATION_PANEL} ${COMPOSER}[data-mode="running"]`)).toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS })
    await expect.poll(async () => (await listState()).ids.length, { message: '分镜方案已写进左栏列表（多出一份）', timeout: DEFAULT_TIMEOUT_MS }).toBe(before.ids.length + 1)
    const after = await listState()
    const created = after.ids.find((id) => !before.ids.includes(id))
    const view = await win().evaluate(() => ({
      storyboardVisible: [...document.querySelectorAll('.workbench-storyboard')].some((element) => element.getBoundingClientRect().width > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none'),
    }))
    const said = await win().locator(`${CREATION_PANEL} ${ASSISTANT_MESSAGE}`).last().innerText()
    record.screenshots.push(await shot('storyboard-not-opened'))
    expect(created, '左栏里多出的那一份就是 Agent 新建的').toBeTruthy()
    expect(after.active, '用户正在看的那份方案没变（新建的没有被设为打开）').toEqual(before.active)
    expect(view.storyboardVisible, '分镜表没有自己出现').toBe(false)
    expect(said, 'Agent 说了分镜写好了、在哪打开').toMatch(EN ? /written[\s\S]*left column/i : /写好了[\s\S]*左栏/)
    record.createdDesignId = created
    return `新方案 ${created}；打开的方案 前 ${JSON.stringify(before.active)} 后 ${JSON.stringify(after.active)}；话：${said.slice(0, 100)}`
  })

  await row('storyboard-user-open', EN ? 'Click the storyboard myself' : '自己点开分镜', EN ? 'It opens normally' : '正常打开', async (record) => {
    const target = rows.find((entry) => entry.id === 'storyboard-not-opened')?.createdDesignId
    await pb.monitor.step('用户：点开左栏里 Agent 写好的分镜方案', async () => {
      await clickOrFail(win().locator(target ? `[data-storyboard-id="${target}"]` : '[data-storyboard-id]').last(), '左栏里的分镜方案')
      await expect(win().locator('.workbench-storyboard').first(), '分镜表打开了').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    }, { surfaces: ['workspaceMode', 'storyboardTable', 'creationSelection'] })
    record.screenshots.push(await shot('storyboard-user-open'))
    return '用户点开后分镜表正常出现'
  })
} catch (error) {
  console.error('[domain-walk] 故障：', error?.stack ?? error)
  fs.writeFileSync(path.join(outputDir, 'rows.json'), JSON.stringify(rows, null, 2))
}
const failed = rows.filter((entry) => entry.result !== 'pass')
console.log(`[domain-walk] ${pb.locale} · ${FIXTURE_KIND}：${rows.length - failed.length}/${rows.length} 通过${failed.length ? '；不通过：' + failed.map((entry) => entry.id).join('、') : ''}`)
const harnessCode = await pb.finish(null)
process.exit(failed.length ? 1 : harnessCode)
