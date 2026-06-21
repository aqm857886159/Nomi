// 渲染层取提示词库的唯一入口(镜像 skillApi 的 requireDesktopRuntime 范式)。
// 主进程已聚合+缓存;这里取全量,搜索/分类过滤是平凡纯函数,放渲染层(不重复后端逻辑)。
import { getDesktopBridge, type DesktopBridge } from '../../desktop/bridge'

export type PromptMediaType = 'image' | 'video'

export type LibraryPrompt = {
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
    title: String(r.title ?? '未命名'),
    prompt,
    mediaUrl: String(r.mediaUrl ?? ''),
    mediaType,
    promptType,
    tags: Array.isArray(r.tags) ? r.tags.map((t) => String(t)) : [],
    source: String(r.source ?? ''),
    sourceId: String(r.sourceId ?? ''),
    sourceUrl: String(r.sourceUrl ?? ''),
  }
}

export async function fetchPromptLibrary(): Promise<LibraryPrompt[]> {
  const desktop = requireDesktopRuntime('prompt library')
  const res = await desktop.promptLibrary!.list()
  if (!res?.ok || !Array.isArray(res.prompts)) return []
  return res.prompts.map(toPrompt).filter((p): p is LibraryPrompt => p !== null)
}

/** 节点提示词优化用的文本大脑键(与创作助手同脑);未配文本模型返回 null。 */
export async function getTextBrain(): Promise<{ vendor: string; modelKey: string } | null> {
  const desktop = requireDesktopRuntime('prompt optimize')
  const res = await desktop.promptLibrary!.textBrain()
  return res?.ok && res.brain ? res.brain : null
}

export type PromptCategory = 'all' | 'image' | 'video'

/** 平凡过滤:分类(全部/图片/视频)+ 关键词(标题/正文/来源)。 */
export function filterPrompts(items: LibraryPrompt[], category: PromptCategory, keyword: string): LibraryPrompt[] {
  const kw = keyword.trim().toLowerCase()
  return items.filter((item) => {
    if (category !== 'all' && item.promptType !== category) return false
    if (!kw) return true
    return `${item.title} ${item.prompt} ${item.source}`.toLowerCase().includes(kw)
  })
}
