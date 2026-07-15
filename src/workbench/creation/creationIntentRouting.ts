/**
 * 创作助手输入的意图路由（对话驱动，用户拍板 2026-06-13 删固定 chip 后）。
 *
 * 删掉「拆镜头 / 立角色卡」执行按钮后，这两个跨面板动作只能由自然语言触发，
 * 所以 pattern 的覆盖面就是用户能不能用上功能的唯一保证——抽成纯函数单测锁死。
 * skill 端再按完整 message 判断单层/轨迹（见 SKILL.md「两种模式」）。
 */

export type CreationIntent = 'storyboard' | 'fixation' | null

// 高召回的拆镜头口径（治脆）：识别到意图后只是弹「动作卡」让用户确认、不静默开跑，
// 所以可以放心放宽——残余漏判由用户换句话兜底，误判只是多一张可忽略的卡，代价低。
// 两路命中：
//  ① 明确名词/动宾：拆镜头/分镜/镜头脚本/storyboard/成片/出片；
//  ② 产生式「动词 + 宾语」：把各种人话（拆/切/变/做/整/铺/排/拍/剪/生成…
//     + 镜头/画面/分镜/视频/短片/片子/一段段/一幕…）一网打尽，
//     接住「整成一段段画面」「铺成画面接画面」「排成分镜」这类旧口径必漏的说法。
// 防误伤：动词表不含「看/通/开」，不裸匹配「片」——「照片/看视频/视频通话」不触发。
// 2026-07-15 用户群反馈仍难触发：补「规划」动词（「规划镜头」）+「场景」宾语（「变成/拆成场景」），
// 二者都要动词打头才命中，不会误伤「这个场景描写不错」这类（描写不在动词表）。
const STORYBOARD_NOUN_PATTERN = /拆镜头|分镜|拆分|镜头脚本|storyboard|成片|出片/i
const STORYBOARD_VERB_OBJECT_PATTERN =
  /(?:拆|切|分|变|做|整|铺|排|拍|剪|生成|搞|弄|规划).{0,6}(?:镜头|分镜|画面|场景|视频|短片|片子|一段段|一格格|一幕幕|一幕)/
const FIXATION_REQUEST_PATTERN = /立角色卡|角色卡|人物卡|定妆|角色设定|建.{0,2}角色/

function isStoryboardRequest(text: string): boolean {
  return STORYBOARD_NOUN_PATTERN.test(text) || STORYBOARD_VERB_OBJECT_PATTERN.test(text)
}

/**
 * 把用户输入归类到跨面板动作。storyboard 优先（「分镜」「拆」类词更高频明确）；
 * 都不命中返回 null → 走通用创作 AI（续写/改写文稿）。
 */
export function routeCreationIntent(text: string): CreationIntent {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (isStoryboardRequest(trimmed)) return 'storyboard'
  if (FIXATION_REQUEST_PATTERN.test(trimmed)) return 'fixation'
  return null
}

/**
 * 编辑器为空时，从用户这条对话消息里抠出「故事正文」当拆镜头素材——别让他把已经
 * 敲在对话框里的故事再手动搬去左侧（D1 摩擦）。两种命中：
 *  ①「…拆成镜头：<故事>」式：冒号后的正文即故事；
 *  ② 没冒号但剥掉命令短语后仍有实质内容：把整条消息交给规划师（LLM 自会忽略命令词）。
 * 裸命令（「帮我拆镜头」）剥完不够长 → 返回 ''，维持「先写故事」提示，不拿命令词当故事。
 */
export function extractStoryFromRequest(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const afterColon = trimmed.split(/[:：]/).slice(1).join('：').trim()
  if (afterColon.length >= 12) return afterColon
  const withoutCommand = trimmed
    .replace(STORYBOARD_NOUN_PATTERN, '')
    .replace(STORYBOARD_VERB_OBJECT_PATTERN, '')
    .replace(/[\s,，。、!！?？]+/g, '')
  return withoutCommand.length >= 12 ? trimmed : ''
}
