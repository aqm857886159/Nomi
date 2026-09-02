/**
 * A run mode is a user preference, not a second permission system. Ask mode
 * should answer ordinary questions without mutating the work, but a plain
 * language action request such as “帮我生成一个小猫头像” must still enter
 * the normal approval/tool path instead of being rejected as chat.
 */
const ACTION_PATTERN = /生成|制作|产出|出图|出视频|创建|添加|修改|删除|导出|拼片|拼成|排进|调用|上传|下载|设置|选择|写一段|做一(?:张|个)|做个|generate|create|make|add|edit|delete|export|arrange|upload|download|set|choose/i
const NEGATED_ACTION_PATTERN = /(?:不要|别|无需|不需要|不用|不想|暂不|暂时不)\s*(?:去\s*)?(?:生成|制作|创建|添加|修改|删除|导出|拼片|上传|下载)|\b(?:do not|don't|dont|no need to|without)\s+(?:generate|create|make|add|edit|delete|export|upload|download)\b/i

export function isAgentActionIntent(text: string): boolean {
  const normalized = text.trim()
  if (!normalized || NEGATED_ACTION_PATTERN.test(normalized)) return false
  return ACTION_PATTERN.test(normalized)
}
