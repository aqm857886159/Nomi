// 渲染层取提示词库的唯一入口(镜像 skillApi 的 requireDesktopRuntime 范式)。
// 主进程已聚合+缓存;这里取全量,搜索/分类过滤是平凡纯函数,放渲染层(不重复后端逻辑)。
import type { SkillCuration } from '../../../electron/shared/skillCuration'
import { getDesktopBridge, type DesktopBridge } from '../../desktop/bridge'
import i18n from '../../i18n'
import { matchesLibraryQuery } from '../library/libraryDiscovery'
import { promptSourceKey } from '../promptLibrary/promptDisplay'

export type PromptMediaType = 'image' | 'video'

export type PromptOrigin = 'public' | 'user'

export type PromptReferenceImage = { url: string; title?: string; sourceUrl?: string }

export type LibraryPrompt = {
  curation?: SkillCuration
  id: string
  title: string
  prompt: string
  mediaUrl: string
  mediaType: PromptMediaType
  promptType: PromptMediaType
  tags: string[]
  source: string
  sourceId: string
  sourceUrl: string
  /** public=外部公开仓库(只读);user=我的库(可改可删,用户级跨项目)。 */
  origin: PromptOrigin
  /** 我的库条目的更新时间(ISO);public 无。 */
  updatedAt?: string
  /** 参考图(网页提取的截图/原图;素材面收敛 2026-07-22 随迁字段,封面 mediaUrl=首图)。 */
  referenceImages?: PromptReferenceImage[]
}

function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop?.promptLibrary) throw new Error(`${feature} requires the Electron desktop runtime`)
  return desktop
}

function toPrompt(raw: unknown): LibraryPrompt | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = String(r.id ?? '')
  const prompt = String(r.prompt ?? '')
  if (!id || !prompt) return null
  const mediaType: PromptMediaType = r.mediaType === 'video' ? 'video' : 'image'
  const promptType: PromptMediaType = r.promptType === 'video' ? 'video' : 'image'
  return {
    id,
    curation: r.curation as SkillCuration | undefined,
    title: String(r.title ?? i18n.t('runtime.promptLibrary.untitled')),
    prompt,
    mediaUrl: String(r.mediaUrl ?? ''),
    mediaType,
    promptType,
    tags: Array.isArray(r.tags) ? r.tags.map((t) => String(t)) : [],
    source: String(r.source ?? ''),
    sourceId: String(r.sourceId ?? ''),
    sourceUrl: String(r.sourceUrl ?? ''),
    origin: r.origin === 'user' ? 'user' : 'public',
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined,
    referenceImages: Array.isArray(r.referenceImages)
      ? (r.referenceImages as unknown[])
          .filter((img): img is PromptReferenceImage =>
            Boolean(img) && typeof img === 'object' && typeof (img as PromptReferenceImage).url === 'string' && (img as PromptReferenceImage).url.length > 0)
      : undefined,
  }
}

export async function fetchPromptLibrary(): Promise<LibraryPrompt[]> {
  const desktop = requireDesktopRuntime('prompt library')
  const res = await desktop.promptLibrary!.list()
  if (!res?.ok || !Array.isArray(res.prompts)) return []
  return res.prompts.map(toPrompt).filter((p): p is LibraryPrompt => p !== null)
}

// —— 我的库(用户级·跨项目):手写攒的提示词 CRUD,均返回全量(渲染层本地过滤)。 ——

function mapUserPrompts(res: { ok?: boolean; prompts?: unknown[] } | undefined): LibraryPrompt[] {
  if (!res?.ok || !Array.isArray(res.prompts)) return []
  return res.prompts.map(toPrompt).filter((p): p is LibraryPrompt => p !== null)
}

export async function fetchUserPrompts(): Promise<LibraryPrompt[]> {
  const desktop = requireDesktopRuntime('my prompt library')
  return mapUserPrompts(await desktop.promptLibrary!.userList())
}

export async function addUserPrompt(input: {
  title?: string
  prompt: string
  promptType: PromptMediaType
  tags?: string[]
  referenceImages?: PromptReferenceImage[]
}): Promise<LibraryPrompt[]> {
  const desktop = requireDesktopRuntime('add prompt')
  const res = await desktop.promptLibrary!.userAdd(input)
  if (!res?.ok) throw new Error(res?.error || i18n.t('runtime.promptLibrary.saveFailed'))
  return mapUserPrompts(res)
}

export async function updateUserPrompt(id: string, patch: { title?: string; prompt?: string; promptType?: PromptMediaType }): Promise<LibraryPrompt[]> {
  const desktop = requireDesktopRuntime('edit prompt')
  const res = await desktop.promptLibrary!.userUpdate(id, patch)
  if (!res?.ok) throw new Error(res?.error || i18n.t('runtime.promptLibrary.updateFailed'))
  return mapUserPrompts(res)
}

export async function deleteUserPrompt(id: string): Promise<LibraryPrompt[]> {
  const desktop = requireDesktopRuntime('delete prompt')
  return mapUserPrompts(await desktop.promptLibrary!.userDelete(id))
}

/** 节点提示词优化用的已配置文本大脑键(与创作助手同脑);未配文本模型返回 null。 */
export async function getTextBrain(): Promise<{ vendor: string; modelKey: string } | null> {
  const desktop = requireDesktopRuntime('prompt optimize')
  const res = await desktop.promptLibrary!.textBrain()
  return res?.ok && res.brain ? res.brain : null
}

export type PromptCategory = 'all' | 'image' | 'video'

/** 「全部来源」哨兵：来源筛选的默认值（不按来源过滤）。用常量避免和真实来源名撞。 */
export const PROMPT_SOURCE_ALL = '__all__'

/**
 * 站外精选条目按「来源」分组——这是数据里现成的字段，不硬造词表。返回按出现顺序去重的
 * **稳定来源键**列表（精选条目 = curation 组名 en 值，不随界面语言变；显示标签由 UI 用
 * promptSourceDisplayLabel 另取，键/显示分离——2026-09-10 走查反馈：原先直接用写死中文的
 * source 当值，切语言时 chips 与过滤一齐失配）；空来源忽略。
 */
export function promptSourceOptions(items: LibraryPrompt[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const source = promptSourceKey(item)
    if (!source || seen.has(source)) continue
    seen.add(source)
    out.push(source)
  }
  return out
}

/** 平凡过滤:分类(全部/图片/视频)+ 来源(全部/某来源的稳定键)+ 关键词(标题/正文/来源/已有标签)。 */
export function filterPrompts(
  items: LibraryPrompt[],
  category: PromptCategory,
  keyword: string,
  source: string = PROMPT_SOURCE_ALL,
): LibraryPrompt[] {
  const byCategory = items.filter((item) => category === 'all' || item.promptType === category)
  const bySource = source === PROMPT_SOURCE_ALL ? byCategory : byCategory.filter((item) => promptSourceKey(item) === source)
  return bySource.filter((item) => matchesLibraryQuery(
    {
      title: item.title,
      description: item.prompt,
      // 搜索关键词中英都给:精选条目的双语标题/组名都参与匹配,中文搜「转台」英文搜 "turntable" 都能中。
      keywords: [
        item.source,
        ...item.tags,
        ...([item.curation?.title['zh-CN'], item.curation?.title.en,
          item.curation?.group['zh-CN'], item.curation?.group.en].filter(Boolean) as string[]),
      ],
    },
    keyword,
  ))
}
