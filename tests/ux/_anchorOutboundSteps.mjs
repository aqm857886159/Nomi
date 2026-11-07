// anchor-outbound（参考卡出站提示词 = 描述框里的字）的两条走查共用的**同一份**步骤本体：
//   · anchor-outbound-real.rehearsal.walk.mjs   零花费演练（本机夹具、假 key、不出网）；
//   · anchor-outbound-real.paid.mjs             真付费，协调跑（同一输入改前 / 改后各一张）。
// 设计卡 docs/plan/2026-11-07-prompt-outbound-description.md ★9。演练和真跑不抄第二份。
//
// 要证的事：创作者在**创作区的分镜方案里**点「生成参考卡」（用户 10-29 那条路：StoryboardPlanEditor → generateAnchorCard 建卡），
// 一张「画风词写在描述里 + 另有结构化特征」的角色参考卡，**发往供应商的那份请求**里提示词包含描述框里的字（含画风词），
// 且不含结构化特征那一段（旧写法会把描述整段换成它）。
// 做法：往隔离资料里预埋一份带这张卡的分镜方案（Agent 起草落盘后的形状），真人手势打开方案、展开参考卡区、点那张卡的「生成」，
// 只读网络账本 / 夹具里真收到的创建请求。脚本不碰 store、不调编译函数替产品拼提示词。
import fs from 'node:fs'
import path from 'node:path'
import { clickOrFail, expect, expectVisible } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { readProject } from './agent-runtime-walk-support.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { setLocale, IMAGE } from './_referenceDeadLinkSteps.mjs'

export { IMAGE }

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

/**
 * 修复才会进产物的字面量：`anchorIdentityBody` 的说明（编译后原样留在 dist-electron，该目录不压缩）。
 * 旧写法保留了同样的分区标题，没有别的稳定字面量可取，所以取这一句；改了那段说明就要同步改这里（_paidRun.test.mjs 核它还在源码里）。
 * 改前对照档（--expect-before）不传：它故意跑在不含修复的构建上。
 */
export const ANCHOR_OUTBOUND_BUILD_OPTIONS = { buildMarkers: ['一个字不丢、不换'] }

// 预埋的方案：Agent 起草「叶秋」定妆卡落盘后的形状——画风词只写在 description，另带 staticFeatures / dynamicFeatures；
// 参考卡指定的就是被授权的那一个图片模型（真人在创作区看到的模型框就是它）。
const PROJECT_ID = 'anchor-outbound-walk'
const DESIGN_ID = 'anchor-outbound-design'
const PROJECT_NAME = '参考卡出站走查'

/** 往这一场的隔离资料里预埋项目（App 起来之前写，项目库里就有这张卡）。和 composer-b3-real 等走查同一手法，不灌 store。 */
export function seedAnchorProject(walk) {
  const projectsDir = path.join(walk.report.tempRoot, 'projects')
  const projectRoot = path.join(projectsDir, PROJECT_ID)
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  const plan = {
    title: PROJECT_NAME,
    anchors: [{ ...ANCHOR, scope: 'selective', modelKey: IMAGE.modelKey, modelVendor: IMAGE.vendorKey }],
    shots: [{ index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 3, anchorIds: [], prompt: '雨夜，古装女侠走进客栈', modelKey: IMAGE.modelKey, modelVendor: IMAGE.vendorKey }],
  }
  const project = {
    id: PROJECT_ID, name: PROJECT_NAME, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot,
    payload: {
      workbenchDocuments: [{ id: 'doc-1', version: 1, title: PROJECT_NAME, updatedAt: 10, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '雨夜，古装女侠走进客栈。' }] }] } }],
      activeDocumentId: 'doc-1', timeline: null,
      generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
      storyboardDesignsByDocumentId: { 'doc-1': [{ id: DESIGN_ID, documentId: 'doc-1', title: PROJECT_NAME, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
    },
  }
  for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) fs.writeFileSync(file, JSON.stringify(project, null, 2))
  // 付费收据 / 日志收集按这两个字段找项目目录（newProject 在别的走查里替它们填）。
  walk.report.projectId = PROJECT_ID
  walk.report.projectRoot = projectRoot
  return { projectId: PROJECT_ID, projectRoot, designId: DESIGN_ID }
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

const LABELS = {
  'zh-CN': { creation: '创作', expandAll: '全部展开', generateAnchor: (name) => `生成参考卡「${name}」` },
  en: { creation: 'Create', expandAll: 'Expand all', generateAnchor: (name) => `Generate reference card "${name}"` },
}

/** 打开项目 → 创作区 → 打开那份方案 → 展开参考卡区；返回那张卡的容器。 */
async function openAnchorCard({ win, locale }) {
  const text = LABELS[locale]
  const projectCard = win.locator('[data-project-card]', { hasText: PROJECT_NAME }).first()
  // 换语言会重载页面：有时回到项目库，有时仍在项目里（上次的工作区），两种都认。
  const createTab = win.getByRole('button', { name: text.creation, exact: true })
  const where = await Promise.any([
    projectCard.waitFor({ state: 'visible', timeout: stationTimeout() }).then(() => 'library'),
    createTab.waitFor({ state: 'visible', timeout: stationTimeout() }).then(() => 'project'),
  ]).catch(() => { throw new Error('页面既不是项目库（有走查项目卡）也不是项目内（有「创作」页签）') })
  if (where === 'library') await projectCard.dblclick()
  await clickOrFail(createTab, '切到创作页')
  await openStoryboardEditor(win, DESIGN_ID, '打开分镜方案')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器没有渲染')
  const card = win.locator(`[data-anchor-card="${ANCHOR.id}"]`)
  await expectVisible(card, '参考卡区里有「叶秋」那张卡')
  // 参考卡区默认收着：有「全部展开」就点开；已经开着（换语言重载后）就不点。
  const expand = win.getByRole('button', { name: text.expandAll, exact: true })
  if (await expand.isVisible().catch(() => false)) await clickOrFail(expand, '展开参考卡区')
  return card
}

/**
 * 整条旅程（用户 10-29 那条路）：开项目 → 创作区打开方案 → 点参考卡「生成」→ 等这一次生成走到结局 → 核请求；
 * 再切英文界面各截一张（不再花钱）。
 * expectBefore = true 时（改前构建的对照记录）不因请求里没有描述而失败，只把读数写进证据。
 */
export async function runAnchorOutboundJourney({ paid, evidence, observe, expectBefore = false }) {
  const { walk } = paid
  const seeded = seedAnchorProject(walk)
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await paid.lockToAuthorizedModels(win)
  await setLocale(win, 'zh-CN')
  const card = await openAnchorCard({ win, locale: 'zh-CN' })
  await walk.snap('anchor-card-zh')
  const offset = observe().length
  await clickOrFail(card.getByRole('button', { name: LABELS['zh-CN'].generateAnchor(ANCHOR.name) }), '点参考卡「叶秋」的生成')
  await expect.poll(() => observe().length - offset, { message: '点生成后供应商收到创建请求', timeout: stationTimeout({ operations: 2 }) }).toBeGreaterThan(0)
  const latestRun = async () => {
    const nodes = (await readProject(win, seeded.projectId)).payload.generationCanvas.nodes ?? []
    return nodes.find((node) => node.runs?.length)?.runs?.at(-1) ?? null
  }
  await expect.poll(async () => (await latestRun())?.status ?? 'unsubmitted', { message: '这一次生成走到结局', timeout: stationTimeout({ turns: 2 }) }).toMatch(/^(success|error|failed|recoverable|cancelled)$/)
  evidence.runStatus = (await latestRun())?.status ?? null
  await walk.snap('anchor-card-landed-zh')
  const judged = judgeAnchorSend(observe().slice(offset))
  evidence.wire = judged.summary
  evidence.problems = judged.problems
  if (judged.problems.length && !expectBefore) throw new Error(`参考卡出站请求核对没过：${judged.problems.join('；')}`)
  if (!expectBefore) expect(evidence.runStatus, '这一次生成成功').toBe('success')
  evidence.verified = ['anchor-description-reaches-provider', 'no-structured-suffix', 'one-post-per-submission']
  // 英文界面各截一张（同一张卡，不再点生成）。
  await setLocale(win, 'en')
  await openAnchorCard({ win, locale: 'en' })
  await expectVisible(win.getByText('Keep consistent across shots', { exact: true }), '英文界面里参考卡区的标题是英文')
  await walk.snap('anchor-card-en')
}
