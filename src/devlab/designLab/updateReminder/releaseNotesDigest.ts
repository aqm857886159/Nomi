// 发版说明 → 更新弹窗 / 更新后卡片要显示的那几行（D-update 样张，2026-10-08）。
//
// 发版说明的约定结构（docs/release-notes/vX.md）：
//   # Nomi vX — 标题句
//   首段一句话
//   ## 中文分组 …（列表项以 **加粗短语** 开头）
//   ## What changed（英文段：直接是列表，或再按 ### 分组）
//
// 只取当前界面语言那一段、按分组、每组最多 N 条、每条只取加粗短语，正文不要。
// 解析用仓库已有的 `marked`（词法器给出标题 / 列表 / 加粗的 token 树），不手写正则状态机；
// 正则只用来剥掉 PR 号「（#953）」和句末标点这种纯文本清理。
//
// 结构对不上（没有 H1、当前语言没有那一段、列表项没有加粗）时不硬凑：对应字段给空，
// 界面据此只显示版本号和「完整说明」链接，不把乱的 Markdown 原样贴出来。
import { marked, type Token, type Tokens } from 'marked'

export type ReleaseNotesLocale = 'zh' | 'en'

export type ReleaseNotesGroup = Readonly<{
  /** 分组名（中文段的 `##` / 英文段的 `###`）；英文段第一个 `###` 之前的列表归入无名组。 */
  heading: string | null
  /** 每条列表项的加粗短语，已剥 PR 号与句末标点。 */
  items: readonly string[]
}>

export type ReleaseNotesDigest = Readonly<{
  /** H1 里「—」后面那句标题；只在中文段有（英文段没有标题行）。 */
  title: string | null
  groups: readonly ReleaseNotesGroup[]
  /** 超出 maxGroups 没显示的分组数。 */
  hiddenGroups: number
}>

export type DigestOptions = Readonly<{ maxGroups?: number; maxItemsPerGroup?: number }>

const ENGLISH_SECTION = /^what changed$/i

/** 「（#953）」「(#921、#934)」「（#947）。」之类的 PR 号与句末标点。 */
function clean(text: string): string {
  return text
    .replace(/[（(]\s*#\d+(?:\s*[、,，]\s*#\d+)*\s*[）)]/g, '')
    .replace(/[。.:：；;，,\s]+$/u, '')
    .trim()
}

function plainText(tokens: readonly Token[] | undefined): string {
  if (!tokens) return ''
  return tokens.map((token) => {
    const nested = (token as { tokens?: Token[] }).tokens
    if (nested && nested.length) return plainText(nested)
    return 'text' in token && typeof token.text === 'string' ? token.text : ''
  }).join('')
}

/** 列表项里第一个加粗（只看这一项自己的行内内容，不下钻到它的子列表）。 */
function firstStrong(tokens: readonly Token[]): string | null {
  for (const token of tokens) {
    if (token.type === 'list') continue
    if (token.type === 'strong') return plainText((token as Tokens.Strong).tokens) || (token as Tokens.Strong).text
    const nested = (token as { tokens?: Token[] }).tokens
    if (nested) {
      const found = firstStrong(nested)
      if (found !== null) return found
    }
  }
  return null
}

function listItems(tokens: readonly Token[]): string[] {
  const items: string[] = []
  for (const token of tokens) {
    if (token.type !== 'list') continue
    for (const item of (token as Tokens.List).items) {
      const strong = firstStrong(item.tokens)
      if (strong) items.push(clean(strong))
    }
  }
  return items.filter(Boolean)
}

type Section = { heading: string | null; tokens: Token[] }

function splitBy(tokens: readonly Token[], depth: number): Section[] {
  const sections: Section[] = []
  let current: Section = { heading: null, tokens: [] }
  for (const token of tokens) {
    if (token.type === 'heading' && (token as Tokens.Heading).depth === depth) {
      if (current.heading !== null || current.tokens.length) sections.push(current)
      current = { heading: clean(plainText((token as Tokens.Heading).tokens)), tokens: [] }
      continue
    }
    current.tokens.push(token)
  }
  if (current.heading !== null || current.tokens.length) sections.push(current)
  return sections
}

export function digestReleaseNotes(markdown: string, locale: ReleaseNotesLocale, options: DigestOptions = {}): ReleaseNotesDigest {
  const maxGroups = options.maxGroups ?? 4
  const maxItems = options.maxItemsPerGroup ?? 3
  const tokens = marked.lexer(markdown ?? '')

  const h1 = tokens.find((token): token is Tokens.Heading => token.type === 'heading' && (token as Tokens.Heading).depth === 1)
  const h1Text = h1 ? plainText(h1.tokens) : ''
  const dash = h1Text.search(/\s[—–-]\s/)
  const zhTitle = dash >= 0 ? clean(h1Text.slice(dash + 3)) || null : null

  const englishAt = tokens.findIndex((token) => token.type === 'heading'
    && (token as Tokens.Heading).depth === 2
    && ENGLISH_SECTION.test(plainText((token as Tokens.Heading).tokens).trim()))

  let sections: Section[]
  if (locale === 'zh') {
    const body = tokens.slice(0, englishAt >= 0 ? englishAt : tokens.length)
    // H2 之前（H1 + 首段）不是分组。
    sections = splitBy(body, 2).filter((section) => section.heading !== null)
  } else {
    sections = englishAt >= 0 ? splitBy(tokens.slice(englishAt + 1), 3) : []
  }

  const groups = sections
    .map((section) => ({ heading: section.heading, items: listItems(section.tokens).slice(0, maxItems) }))
    .filter((group) => group.heading !== null || group.items.length > 0)

  return {
    title: locale === 'zh' ? zhTitle : null,
    groups: groups.slice(0, maxGroups),
    hiddenGroups: Math.max(0, groups.length - maxGroups),
  }
}

/** 更新后卡片要的「最多 N 条」：按分组顺序摊平。 */
export function digestHighlights(digest: ReleaseNotesDigest, max = 3): string[] {
  return digest.groups.flatMap((group) => group.items).slice(0, max)
}

/**
 * 跳了几版：合成一张卡。标题取最新那一版，条目从新到旧摊平取前 N 条。
 * `digests` 按版本从新到旧传。
 */
export function mergeDigests(digests: readonly ReleaseNotesDigest[], max = 3): { title: string | null; items: string[] } {
  return {
    title: digests.find((digest) => digest.title)?.title ?? null,
    items: digests.flatMap((digest) => digestHighlights(digest, max)).slice(0, max),
  }
}

/** 胶囊上的版本号：0.24.0 → 0.24，0.23.1 原样。 */
export function shortVersion(version: string): string {
  return version.replace(/^(\d+\.\d+)\.0$/, '$1')
}

/** 第三位变 = 热修版（0.23.1）；第三位是 0 = 攒批版（0.24.0）。 */
export function isHotfixVersion(version: string): boolean {
  const patch = /^\d+\.\d+\.(\d+)/.exec(version)?.[1]
  return patch !== undefined && patch !== '0'
}
