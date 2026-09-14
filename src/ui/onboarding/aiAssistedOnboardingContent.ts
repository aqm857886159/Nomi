/**
 * 「用 AI 帮我接入」这张卡要交到用户手上的**东西本身**（不含界面）。
 *
 * 设计定稿：docs/design/2026-09-11-ai-assisted-onboarding-entry.md
 *
 * 为什么单独一个模块：这三段内容既要被卡渲染、被剪贴板复制，也要被走查逐字断言。
 * 放在组件里就只能靠截图证明「复制对了」，那证明不了内容。
 */
import skillMarkdown from '../../../agent-skills/nomi-add-model/SKILL.md?raw'
import { ASSISTANT_CLIENT_ORDER, type AssistantClientKey } from './assistantActivationState'

/**
 * 卡上的宿主分段。前三个是 Nomi 能一键写配置、且用户真会带来的宿主（设计定稿 §Main）；
 * `other` 是所有别的（含 Cursor / Claude Desktop——它们同样能一键接入，卡上另给一行指路）。
 */
export const ASSISTED_ONBOARDING_HOSTS = ['workbuddy', 'codex', 'claude', 'other'] as const
export type AssistedOnboardingHost = typeof ASSISTED_ONBOARDING_HOSTS[number]

/** 分段里那三个宿主对应的 MCP 客户端 key（类型对上 = 改名字时编译期就红）。 */
export const ASSISTED_ONBOARDING_CLIENT_KEYS: Record<Exclude<AssistedOnboardingHost, 'other'>, AssistantClientKey> = {
  workbuddy: 'workbuddy',
  codex: 'codex',
  claude: 'claude',
}

/** 「其它」那一段里要点名的、Nomi 同样能一键接入的宿主——从真实客户端表里 derive，不手列。 */
export const OTHER_ONE_CLICK_CLIENTS: readonly AssistantClientKey[] = ASSISTANT_CLIENT_ORDER.filter(
  (key) => !Object.values(ASSISTED_ONBOARDING_CLIENT_KEYS).includes(key),
)

export const ASSISTED_ONBOARDING_SKILL_NAME = 'nomi-add-model'
export const ASSISTED_ONBOARDING_SKILL_PATH = `${ASSISTED_ONBOARDING_SKILL_NAME}/SKILL.md`
/** 技能包原文。真相源是 agent-skills/nomi-add-model/SKILL.md，这里只是它的一个读者。 */
export const ASSISTED_ONBOARDING_SKILL_MARKDOWN = skillMarkdown.trim()

// 「其它」宿主要粘的 MCP 配置片段：通用未签名条目，owner 在 ./mcpGenericSnippet（AI 助手连接页的
// 「其他客户端 · 复制通用配置」复制的是同一份），这里不再另写一份。

export type AssistedOnboardingClipboardInput = {
  host: AssistedOnboardingHost
  /** 已 i18n 的任务提示词正文（用户粘到助手对话框里的那句话）。 */
  prompt: string
  /** 已 i18n 的三段小标题。 */
  headings: { prompt: string; skill: string; mcp: string }
  /** 只有 host === 'other' 时才给；给了也只有 other 会带上（见设计定稿「删除清单」）。 */
  mcpSnippet?: string | null
}

/**
 * 拼出真正进剪贴板的那段文字。用 Markdown 小标题分段：目的地是一个对话框，
 * 助手读它、人也读它，两边都认这个格式。
 */
export function buildAssistedOnboardingClipboard(input: AssistedOnboardingClipboardInput): string {
  const sections = [
    `## ${input.headings.prompt}\n\n${input.prompt.trim()}`,
    `## ${input.headings.skill}\n\n\`${ASSISTED_ONBOARDING_SKILL_PATH}\`\n\n${ASSISTED_ONBOARDING_SKILL_MARKDOWN}`,
  ]
  if (input.host === 'other' && input.mcpSnippet) {
    sections.push(`## ${input.headings.mcp}\n\n\`\`\`json\n${input.mcpSnippet.trim()}\n\`\`\``)
  }
  return `${sections.join('\n\n---\n\n')}\n`
}
