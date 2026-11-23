import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts'

// Match explicit instructions about running generation. A negated visual detail
// can use the same verb with a different object ("do not generate text watermarks").
const quotedText = /"[^"]*"|“[^”]*”|「[^」]*」|『[^』]*』|`[^`]*`/gu
const clauseBreak = /[，,。！？!?；;\n]+|\.(?=\s|$)/u
const chineseHold = /^(?:请\s*)?(?:(?:只|仅)(?:改|修改|调整)(?:草稿)?参数|(?:先)?(?:别|不要)(?:先)?(?:生成|出图|跑)(?:\s*(?:这[些几]|所有|任何)?(?:图片|图像|视频|镜头|成片|任务))?\s*(?:了|吧)?\s*(?:先|现在)?)$/u
const englishHold = /^(?:please\s+)?(?:(?:don['’]t|do not)\s+generate(?:\s+(?:anything|(?:the\s+)?(?:images?|videos?|shots?)))?|draft only|only\s+(?:edit|change|adjust)\s+(?:the\s+)?(?:draft\s+)?parameters)(?:\s+(?:yet|for now))?$/iu
const withoutGenerating = /(?:^|\s)without generating(?:\s+anything)?$/iu

export function holdsTurnGeneration(text: string): boolean {
  return text.normalize('NFKC').replace(quotedText, '…').split(clauseBreak).some(part => {
    const clause = part.trim()
    return chineseHold.test(clause) || englishHold.test(clause) || withoutGenerating.test(clause)
  })
}

/** Card replies are accepted before any other tool in the same model reply runs. */
export function recordTurnGenerationHold(context: LaneComposerContext | undefined, reply: string): void {
  if (context && holdsTurnGeneration(reply)) context.generationHeld = true
}

export const TURN_GENERATION_HOLD_MESSAGE = 'Generation is on hold for this turn at the user’s request.'
export const TURN_GENERATION_HOLD_NEXT = 'Save any requested draft edits, then summarize the result. Wait for a new request to generate.'
