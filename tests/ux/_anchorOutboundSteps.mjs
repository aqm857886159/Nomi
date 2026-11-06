// anchor-outbound（参考卡出站提示词 = 描述框里的字）的两条走查共用的**同一份**步骤本体：
//   · anchor-outbound-real.rehearsal.walk.mjs   零花费演练（本机夹具、假 key、不出网）；
//   · anchor-outbound-real.paid.mjs             真付费，协调跑（同一输入改前 / 改后各一张）。
// 设计卡 docs/plan/2026-11-07-prompt-outbound-description.md ★9。演练和真跑不抄第二份。
//
// 要证的事：一张带「画风词在描述里 + 另有结构化特征」的角色参考卡，点生成后**发往供应商的那份请求**里，提示词包含描述框里的字（含画风词），
// 且不含结构化特征那一段（旧写法会把描述整段换成它）。
// 做法：提示词由**构建产物里的编译函数**算出（dist-electron，和创作区 / 整方案落画布走的是同一个函数），原样放进一个图片节点的提示词框，
// 点 ↑ 生成，只读网络账本 / 夹具里真收到的创建请求。脚本不碰 store、不替产品拼提示词。
import { createRequire } from 'node:module'
import { clickOrFail, expect } from './_assert.mjs'
import { canvasFitView, collapseAgentPanel } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { openCanvas, readProject } from './agent-runtime-walk-support.mjs'
import { generateOnce, setLocale, IMAGE } from './_referenceDeadLinkSteps.mjs'

export { IMAGE }
const require = createRequire(import.meta.url)

/** 样本卡：画风词只写在描述里（Agent 起草的真实形状），另有一段结构化的身份特征。 */
export const ANCHOR = {
  id: 'walk-anchor-1',
  kind: 'character',
  carrier: 'visual',
  name: '叶秋',
  description: '古装女侠，写实电影质感，35mm 胶片颗粒，冷色调，不要插画风',
  staticFeatures: '瓜子脸、左眉一道浅疤',
  dynamicFeatures: '青灰色窄袖长衫',
}
/** 描述里要原样出现在请求里的字 */
export const STYLE_WORDS = ['写实电影质感', '35mm 胶片颗粒', '不要插画风']
/** 旧写法才有的结构化分区标题 */
export const STRUCTURED_MARKER = '身份特征（跨镜保持一致）'

// 这条样本的付费走查配置，真付费与演练共用；两边都**自己直接**调 openPaidWalk（_paidRun.test.mjs 按文件找 openPaidWalk 调用）。
// 没有托管上传（没有参考图）；记放行请求的请求体。不传构建标记：本修复没有只在修复后才出现的稳定字面量，改靠花钱前自检（见 runAnchorOutboundJourney）。
export const ANCHOR_OUTBOUND_PAID_MODELS = [IMAGE]
export const ANCHOR_OUTBOUND_PAID_OPTIONS = { hostedUploads: false, recordAllowedBodies: true }

/** 用构建产物里的编译函数算这张卡的出站提示词（花钱前先自检：改前的构建会算出不含描述的那份）。 */
export function compileAnchorPrompt(anchor = ANCHOR) {
  const compiler = require('../../dist-electron/shared/storyboard/storyboardPromptCompiler.js')
  return compiler.buildAnchorSheetPrompt(anchor)
}

const collapse = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()

function promptsIn(value, out = []) {
  if (typeof value === 'string') { if (value.length > 40) out.push(value) }
  else if (Array.isArray(value)) value.forEach((item) => promptsIn(item, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => promptsIn(item, out))
  return out
}

/** 夹具收到的创建请求 → 每笔里的长文本字段（提示词）。 */
export function observeFixturePrompts(fixture) {
  return fixture.images.map((record) => ({ texts: promptsIn(record.body) }))
}

/** 网络账本 → 同样的观察。 */
export function observeLedgerPrompts(entries, { host }) {
  return entries
    .filter((entry) => entry.kind === 'allowed-request' && entry.host === host && entry.method === 'POST' && /\/images\/generations$/.test(new URL(entry.url).pathname))
    .map((entry) => {
      let body = null
      try { body = entry.body?.text ? JSON.parse(String(entry.body.text)) : null } catch { /* 截断或非 JSON */ }
      return { texts: body ? promptsIn(body) : [], truncated: Boolean(entry.body?.truncated) }
    })
}

/** 纯判据：恰一笔创建请求；请求里的提示词含描述原文与画风词，不含结构化分区。 */
export function judgeAnchorSend(observed, { anchor = ANCHOR } = {}) {
  const problems = []
  if (observed.length !== 1) problems.push(`供应商收到的创建请求有 ${observed.length} 笔（应恰好 1 笔）`)
  const sent = collapse((observed[0]?.texts ?? []).join(' '))
  if (observed[0]?.truncated) problems.push('创建请求的请求体超过记账上限被截断')
  if (!sent) problems.push('创建请求里读不到提示词')
  const hasDescription = sent.includes(collapse(anchor.description))
  const missingStyle = STYLE_WORDS.filter((word) => !sent.includes(word))
  const hasStructured = sent.includes(STRUCTURED_MARKER) || sent.includes(anchor.staticFeatures)
  if (!hasDescription) problems.push('发出去的提示词不含描述框里的字')
  if (missingStyle.length) problems.push(`画风词没发出去：${missingStyle.join('、')}`)
  if (hasStructured) problems.push('发出去的提示词带了结构化特征那一段（不该追加）')
  return { problems, summary: { createRequests: observed.length, sentContainsDescription: hasDescription, missingStyleWords: missingStyle, sentContainsStructuredFeatures: hasStructured, promptChars: sent.length } }
}

async function addImageNodeWithPrompt({ win, projectId, prompt }) {
  const nodesOnDisk = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes ?? []
  const before = new Set((await nodesOnDisk()).map((node) => node.id))
  await clickOrFail(win.getByRole('button', { name: /添加图片节点|Add image node/i }).first(), '画布「添加图片节点」')
  const fresh = async () => (await nodesOnDisk()).find((node) => !before.has(node.id) && node.kind === 'image')
  await expect.poll(async () => Boolean(await fresh()), { message: '新图片节点落盘', timeout: stationTimeout() }).toBe(true)
  const nodeId = (await fresh()).id
  const node = win.locator(`[data-node-id="${nodeId}"]`)
  await canvasFitView(win, '缩放到新节点可见')
  await node.click({ position: { x: 8, y: 8 } })
  await node.locator('[contenteditable="true"]').last().fill(prompt)
  await win.keyboard.press('Escape')
  const meta = (await nodesOnDisk()).find((candidate) => candidate.id === nodeId)?.meta ?? {}
  expect({ vendor: meta.modelVendor, model: meta.modelKey }, '花钱之前：节点的模型就是被授权的那一个').toEqual({ vendor: IMAGE.vendorKey, model: IMAGE.modelKey })
  return { nodeId, node, readNode: async () => (await nodesOnDisk()).find((candidate) => candidate.id === nodeId) }
}

/**
 * 整条旅程：算提示词 → 放进新图片节点 → 点生成 → 核请求。
 * expectBefore = true 时（改前构建的对照记录）不因请求里没有描述而失败，只把读数写进证据。
 */
export async function runAnchorOutboundJourney({ paid, evidence, observe, expectBefore = false }) {
  const { walk } = paid
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  const prompt = compileAnchorPrompt()
  evidence.compiledPrompt = prompt
  // 花钱之前的自检：构建出来的编译函数算出的提示词里有描述（改前的构建没有；对照档只记录）。
  const compiledHasDescription = collapse(prompt).includes(collapse(ANCHOR.description))
  evidence.compiledHasDescription = compiledHasDescription
  if (!expectBefore) expect(compiledHasDescription, '花钱之前：构建产物算出的提示词包含描述（构建不含这次修复就一分钱不花）').toBe(true)
  await paid.lockToAuthorizedModels(win)
  await setLocale(win, 'zh-CN')
  const { projectId } = await walk.newProject()
  await openCanvas(win)
  await collapseAgentPanel(win)
  const target = await addImageNodeWithPrompt({ win, projectId, prompt })
  const offset = observe().length
  await walk.snap('before-generate')
  const run = await generateOnce({ win, reference: target })
  expect(run?.status, '这一次生成成功').toBe('success')
  await walk.snap('landed')
  const judged = judgeAnchorSend(observe().slice(offset))
  evidence.wire = judged.summary
  if (judged.problems.length && !expectBefore) throw new Error(`参考卡出站请求核对没过：${judged.problems.join('；')}`)
  evidence.problems = judged.problems
  evidence.verified = ['anchor-description-reaches-provider', 'no-structured-suffix', 'one-post-per-submission']
}
