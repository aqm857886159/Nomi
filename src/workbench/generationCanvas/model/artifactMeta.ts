// agent-artifact 节点的 meta.artifact 元数据：AI 手艺产物（不调模型直接做出的表达物）的画布承载。
//
// 设计约束（见 docs/plan/2026-09-06-agent-artifact-node.md §4.1）：
// - 不扩展 GenerationResultType（zod 5 值闭集，media 白名单/下载扩展名链密集消费）——产物元数据
//   挂在 node.meta.artifact，渲染走 BaseGenerationNode 的 kind 专属分支（scene3d/panorama 同级）。
// - url 必须带真实扩展名（svg/html/md…）：主进程下载按 url 扩展名补全，无需动 useResultDownload 闭集。
// - 本节点不作参考槽源（providesImageReference 缺省 false）：要当参考图 → 浮条"固化为参考图"
//   栅格化 PNG 走 assetImportAdapter 另存 asset 节点（参考语义归 asset，不双源）。
//
// v1 只落高频手艺类型；类型列表开放，按"一行 fileType + 一个子视图"逐个长（图表/思维导图/PDF = P1）。
import type { GenerationCanvasNode } from './generationCanvasTypes'

export const ARTIFACT_FILE_TYPES = ['svg', 'html', 'markdown', 'table', 'text', 'glb'] as const
export type ArtifactFileType = (typeof ARTIFACT_FILE_TYPES)[number]

/** node.meta.artifact 的持久化形状。 */
export type AgentArtifactMeta = {
  /** 手艺产物类型（决定 ArtifactBody 渲染哪个子视图 + 浮条动作集合）。 */
  fileType: ArtifactFileType
  /** nomi-local:// 产物文件门牌号，**必须带真实扩展名**（svg/html/md/glb…）。 */
  url: string
  /** 来源 Agent 会话/任务标识（审计与溯源用，可选）。 */
  agentRunId?: string
}

export const ARTIFACT_FILE_EXTENSION: Record<ArtifactFileType, string> = {
  svg: 'svg',
  html: 'html',
  markdown: 'md',
  table: 'html',
  text: 'txt',
  glb: 'glb',
}

/** 产物类型 → 展示 chip 文本（短标签；完整走 i18n 的归 i18n，此处为 fallback + 单元测试用）。 */
export const ARTIFACT_FILE_TYPE_LABEL: Record<ArtifactFileType, string> = {
  svg: 'SVG',
  html: 'HTML',
  markdown: 'Markdown',
  table: 'Table',
  text: 'Text',
  glb: '3D',
}

export function isArtifactFileType(value: unknown): value is ArtifactFileType {
  return typeof value === 'string' && (ARTIFACT_FILE_TYPES as readonly string[]).includes(value)
}

/** 读 meta.artifact（宽松：旧/手写数据缺字段时返回 undefined，调用方兜底）。 */
export function readAgentArtifactMeta(node: Pick<GenerationCanvasNode, 'meta'>): AgentArtifactMeta | undefined {
  const artifact = (node.meta || {})['artifact']
  if (!artifact || typeof artifact !== 'object') return undefined
  const candidate = artifact as Partial<AgentArtifactMeta>
  if (!isArtifactFileType(candidate.fileType) || typeof candidate.url !== 'string' || !candidate.url) return undefined
  return { fileType: candidate.fileType, url: candidate.url, agentRunId: candidate.agentRunId }
}

/** agent-artifact kind 专属：产物是否可"固化为参考图"（v1 = svg，栅格化 PNG 走 asset 导入）。 */
export function canArtifactBecomeReference(fileType: ArtifactFileType): boolean {
  return fileType === 'svg'
}

/** 产物内容是否可"复制为文本"（text/markdown/html 取文件原文进剪贴板；svg/table/glb 不复制）。 */
export function canArtifactCopyText(fileType: ArtifactFileType): boolean {
  return fileType === 'text' || fileType === 'markdown' || fileType === 'html'
}
