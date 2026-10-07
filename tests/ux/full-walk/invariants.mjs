// 全功能走查的**九条铁律**（唯一一份）+ 监视器用到的每一个上限/时限（全部从现有登记处读，不在这里编数字）。
//
// 测法（2026-09-29 定）：先定几条「用户不管怎么用都必须成立」的铁律，带着真实任务到处用、乱用，
// 每一步都核对。第一产出是**证据**——违反了哪条、发生在哪个模块——有了证据才能归到底层设计问题上。
//
// 读数的规矩：上限和时限只从产品自己的登记处取（`generationPhaseDeadline.ts`、`generationFeedback.ts`、
// `laneContextBudget.mts`、`laneHost.mts`、`multiShotBatchScheduler.ts`……）。读不到就**当场报错**
// （fail-closed），绝不回落到一个本地写死的数——那样登记处改了、监视器还拿着旧数判，两边各说各话。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { require as tsxRequire } from 'tsx/cjs/api'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export const INVARIANTS = Object.freeze([
  Object.freeze({
    id: 1, key: 'no-spend-without-consent',
    title: Object.freeze({ 'zh-CN': '没经用户点头不花钱', en: 'No spend without the user saying yes' }),
    how: '供应商收到的每一笔提交（夹具记账）都要能对上一次用户确认（付费卡确认 / 用户自己点生成 / 用户切到全自动），而且落在那次确认按钮承诺的范围里；另：网络闸拦到任何打向真实供应商域名的请求，同样判违反。',
  }),
  Object.freeze({
    id: 2, key: 'no-double-charge',
    title: Object.freeze({ 'zh-CN': '同一镜头不重复扣钱', en: 'One shot is never charged twice' }),
    how: '同一次确认里同一镜（同一提示词 / 同一镜头身份）最多提交一次；制作 Run 里同一镜拿到供应商任务号的 job 不超过它被确认的次数。',
  }),
  Object.freeze({
    id: 3, key: 'shown-equals-sent',
    title: Object.freeze({ 'zh-CN': '界面上看到的就是发出去的', en: 'What the UI shows is what gets sent' }),
    how: '确认那一刻读下卡/节点上摆的模型、关键参数、参考图数量、范围（标题写几镜 / 按钮承诺几镜），与供应商真正收到的请求逐项比；附件、设置里声明的默认模型同理。',
  }),
  Object.freeze({
    id: 4, key: 'claims-are-true',
    title: Object.freeze({ 'zh-CN': '说的都是真的', en: 'What we say is true' }),
    how: '界面状态文字与宿主递给模型的回执（「已经开始」「排队中」「预算已用完」「操作没成功，稍后再试」……）出现时，去读 Run / 任务 / 节点落盘状态，对不上就违反。',
  }),
  Object.freeze({
    id: 5, key: 'no-endless-spinner',
    title: Object.freeze({ 'zh-CN': '不会永远转圈', en: 'Nothing spins forever' }),
    how: '页面里每个永动动画（转圈）都记下出现时刻与归属；归属有登记时限的（节点生成各阶段、制作调度一轮、Agent 空闲）按时限判，没有登记的在「该收场的检查点」仍在转就判违反。',
  }),
  Object.freeze({
    id: 6, key: 'nothing-moves-by-itself',
    title: Object.freeze({ 'zh-CN': '用户没动的东西不会自己动', en: 'Nothing moves unless the user moved it' }),
    how: '页内记下每一次「面」的变化（工作区、分镜表、右侧面板、Agent 面板收展、模态框、画布视口）；不在用户这一步声明的目标里的变化都判违反。',
  }),
  Object.freeze({
    id: 7, key: 'visible-and-closable',
    title: Object.freeze({ 'zh-CN': '看得见、关得掉', en: 'Visible and closable' }),
    how: '每一步收尾时量每个弹出层：关闭钮在视口内且点得到、弹层本体不出视口（最小窗 1100×720 也量）；英文界面可见文字里不许有中文；中文界面的提示 / 报错里不许原样出现供应商英文原话（7c）。',
  }),
  Object.freeze({
    id: 8, key: 'no-token-burn',
    title: Object.freeze({ 'zh-CN': '不白烧 token', en: 'No token burn' }),
    how: '从 Agent 转录里现成的用量记录（每条回复的 usage.input）读每一次模型请求的输入 token，超过上限即违反；上限与依据见 LIMITS.agentInputTokensPerRequest。',
  }),
  Object.freeze({
    id: 9, key: 'nothing-useless-shown',
    title: Object.freeze({ 'zh-CN': '不显示没用的东西', en: 'Nothing useless is shown' }),
    how: '逐条规则核对：9a 只有 1 版时不显示「几版」；9b「已保存到项目」过了登记的回执窗口不许还挂着；9c 同一条提示不因同一次失败重复叠「×N」。',
  }),
  // 2026-10-05 体验铁律第一批（docs/plan/2026-10-05-experience-iron-laws-batch1.md）。⑩ ⑪ 是单测 / 评测，不在走查里判；
  // ⑫ 要真点、真看，所以住在这里。它只在剧本显式调 `monitor.checkClickTarget` 时判，不改上面九条的任何判据。
  Object.freeze({
    id: 12, key: 'click-matches-expectation',
    title: Object.freeze({ 'zh-CN': '点了 = 以为的', en: 'A click does what the user expected' }),
    how: '对 catalog.mjs 登记的每个可点目标：点之前读下页面（行、选中、透明度、菜单、弹层、落盘状态），点之后再读一遍，和登记的 userExpectation 逐项对照；对不上就记违反，并把这一条写进逃逸账本的 candidate。实际结果只来自这一场真点出来的 DOM 与落盘，不从代码推断。',
  }),
])

export const NUISANCE_RULES = Object.freeze([
  Object.freeze({ id: '9a', text: '只有 1 版时不显示「几版」胶囊（useNodeResultHistory.ts 的 nodeHasResultStack：≥2 版才有角标；重拍住在节点浮条）' }),
  Object.freeze({ id: '9b', text: '「已保存到项目」只在登记窗口内出现（SAVED_FEEDBACK_WINDOW_MS + 一格时钟）' }),
  Object.freeze({ id: '9c', text: '同一次失败不许把同一条提示叠成「×N」（N 大于真实失败次数）' }),
])

export function invariantById(id) {
  const found = INVARIANTS.find((entry) => entry.id === id)
  if (!found) throw new Error(`没有第 ${id} 条铁律`)
  return found
}

/** 从源码里读一个 `export const NAME = <数字字面量>`（可带 `_` 分隔）。读不到就抛：登记处改了，监视器必须跟着改。 */
export function readNumericConstant(relativeFile, name, { exported = true } = {}) {
  const file = path.join(repoRoot, relativeFile)
  const source = fs.readFileSync(file, 'utf8')
  const pattern = new RegExp(`${exported ? 'export\\s+' : ''}const\\s+${name}\\s*=\\s*([0-9_]+)\\s*;?`)
  const match = pattern.exec(source)
  if (!match) throw new Error(`full-walk 读不到登记的上限 ${name}（${relativeFile}）——登记处改名 / 改写法了，监视器要跟着改，不许回落到本地写死的数`)
  const value = Number(match[1].replace(/_/g, ''))
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${relativeFile} 的 ${name} 不是正数：${match[1]}`)
  return value
}

/** 反馈时钟一格多长（`useGenerationFeedback.ts` 的共享 setInterval）。它决定「窗口到了之后最多再挂多久」。 */
function readFeedbackClockTick() {
  const relative = 'src/workbench/observability/useGenerationFeedback.ts'
  const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8')
  const match = /setInterval\(\(\)\s*=>\s*\{[^}]*\},\s*(\d+)\)/.exec(source)
  if (!match) throw new Error(`full-walk 读不到 ${relative} 里反馈时钟的间隔——写法变了，监视器要跟着改`)
  return Number(match[1])
}

export const UI_LOCALES = Object.freeze(['zh-CN', 'en'])

let cachedDictionaries
/**
 * 界面文案的中英两份词典（`src/i18n/resources.ts`，界面文字的唯一真相源）。
 * 监视器认「界面说了什么」、目录自检核 visibleText 的 key，都从这里读——不在走查里另写一份中文 / 英文原话，
 * 否则文案一改、英文界面那一档就悄悄瞎了（第一版就栽过：英文的「预算已用完」「可能已经提交」全是猜的，一条都没认出来）。
 */
export function loadDictionaries() {
  if (cachedDictionaries) return cachedDictionaries
  const { resources } = tsxRequire('../../../src/i18n/resources.ts', import.meta.url)
  cachedDictionaries = Object.freeze(Object.fromEntries(UI_LOCALES.map((locale) => [locale, resources[locale].translation])))
  return cachedDictionaries
}

/** 词典里的一条文案（`a.b.c`）。读不到就抛：key 改名了，监视器要跟着改，不许回落到自己写的一句。 */
export function uiText(locale, key, dictionaries = loadDictionaries()) {
  const value = String(key).split('.').reduce((node, part) => (node == null ? undefined : node[part]), dictionaries[locale])
  if (typeof value !== 'string') throw new Error(`full-walk 读不到界面文案 ${key}（${locale}）——文案 key 改了，监视器要跟着改`)
  return value
}

/** 把一条带 `{{占位}}` 的文案变成正则源码：字面部分原样转义，占位变成同名捕获组（anchored = 必须从头开始）。 */
export function uiTextPattern(template, { anchored = false } = {}) {
  const body = String(template).split(/(\{\{\s*[A-Za-z0-9_]+\s*\}\})/).map((part) => {
    const placeholder = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(part)
    return placeholder ? `(?<${placeholder[1]}>.+?)` : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('')
  return `${anchored ? '^' : ''}${body}`
}

let cachedLimits
/** 监视器用到的全部上限 / 时限，每一个都带出处。 */
export function loadLimits() {
  if (cachedLimits) return cachedLimits
  const base = import.meta.url
  const { GENERATION_PHASE_DEADLINE } = tsxRequire('../../../src/workbench/generationCanvas/runner/generationPhaseDeadline.ts', base)
  const { SAVED_FEEDBACK_WINDOW_MS } = tsxRequire('../../../src/workbench/observability/generationFeedback.ts', base)
  const laneBudget = readNumericConstant('electron/agentLane/laneContextBudget.mts', 'LANE_CONTEXT_TOKEN_BUDGET')
  cachedLimits = Object.freeze({
    generationPhaseDeadline: Object.freeze({
      value: GENERATION_PHASE_DEADLINE,
      source: 'src/workbench/generationCanvas/runner/generationPhaseDeadline.ts GENERATION_PHASE_DEADLINE',
    }),
    savedFeedbackWindowMs: Object.freeze({
      value: SAVED_FEEDBACK_WINDOW_MS + readFeedbackClockTick(),
      source: 'src/workbench/observability/generationFeedback.ts SAVED_FEEDBACK_WINDOW_MS + useGenerationFeedback.ts 的时钟一格',
    }),
    agentInputTokensPerRequest: Object.freeze({
      value: laneBudget,
      source: 'electron/agentLane/laneContextBudget.mts LANE_CONTEXT_TOKEN_BUDGET',
      why: 'Agent 自己登记的上下文预算：pi 的压缩门槛取 min(预算, 窗口余量)，压缩就是为了让每一次请求的输入落在它之下。'
        + '一次请求的输入超过它 = 压缩没守住（或一次工具结果就把它撑爆），这正是用户看到「一回合几十万 token」的那一族。',
    }),
    agentIdleMs: Object.freeze({
      // 最后一次模型请求之后，lane 最长能「什么都没发生」多久：响应头之前的首字节预算 + 响应头之后第一段正文之前的思考预算
      // （出字之后的空闲预算更短，取不到最大值）。三个预算唯一一份在 laneProviderGuard.mts。
      value: readNumericConstant('electron/agentLane/laneProviderGuard.mts', 'LANE_FIRST_RESPONSE_MS')
        + readNumericConstant('electron/agentLane/laneProviderGuard.mts', 'LANE_FIRST_TOKEN_MS'),
      source: 'electron/agentLane/laneProviderGuard.mts LANE_FIRST_RESPONSE_MS + LANE_FIRST_TOKEN_MS',
    }),
    schedulerPollCapMs: Object.freeze({
      value: readNumericConstant('electron/productionRun/multiShotBatchScheduler.ts', 'POLL_DELAY_CAP_MS', { exported: false }),
      source: 'electron/productionRun/multiShotBatchScheduler.ts POLL_DELAY_CAP_MS（调度器两轮之间最长的等待）',
    }),
    minWindow: Object.freeze((() => {
      const source = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8')
      const width = Number(/minWidth:\s*(\d+)/.exec(source)?.[1])
      const height = Number(/minHeight:\s*(\d+)/.exec(source)?.[1])
      if (!width || !height) throw new Error('full-walk 读不到 electron/main.ts 的 minWidth / minHeight——写法变了，监视器要跟着改')
      return { value: { width, height }, source: 'electron/main.ts BrowserWindow minWidth / minHeight（铁律 7「窗口缩到最小也要测」）' }
    })()),
    // 付费卡 2026-10-05 起随对话投影推送（38db4a3d9 删了它的 1.5 秒轮询，原来读的 POLL_INTERVAL_MS 跟着没了，
    // 整个走查一起动就抛）。界面上还在按节拍追 Run 状态的是制作 Run 视图那一拍，收场检查点等的是它。
    runViewPollMs: Object.freeze({
      value: readNumericConstant('src/workbench/production/useActiveProductionRun.ts', 'POLL_INTERVAL_MS', { exported: false }),
      source: 'src/workbench/production/useActiveProductionRun.ts POLL_INTERVAL_MS（制作 Run 视图追账本的节拍；付费卡已改推送，没有节拍）',
    }),
  })
  return cachedLimits
}
