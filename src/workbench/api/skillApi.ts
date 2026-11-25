// 渲染层调 skill IPC 的唯一入口（镜像 modelCatalogApi 的 requireDesktopRuntime 范式）。
// 能力派生的「权威逻辑」在 electron（deriveSkillNeeds 算 neededProviders 进 DTO，技能库搜索按它认「图片 / 视频」）。
import type { SkillCuration } from '../../../electron/shared/skillCuration'
import { getDesktopBridge, type DesktopBridge } from '../../desktop/bridge'

export type SkillProviderKind = 'text' | 'image' | 'video'

export type SkillListItemDto = {
  cover?: string
  preview?: { url: string; type: 'image' | 'video' }
  curation?: SkillCuration
  body?: string
  directoryName: string
  name: string
  label: string
  description: string | null
  author: string | null
  stageLabels: string[]
  isPlaybook: boolean
  neededProviders: SkillProviderKind[]
  manifestError: string | null
  /** 'user'=可写用户目录（可删/可导出）；'builtin'=安装随附（只读、禁删）。 */
  origin: 'builtin' | 'user'
  packageVersion: string
  contentHash: string
}

type SkillImportResultDto = {
  ok: boolean
  dirName?: string
  skillName?: string
  /** Provider modalities the saved skill declares (derived in the main process). */
  neededProviders?: SkillProviderKind[]
  error?: string
}

type SkillDeleteResultDto = {
  ok: boolean
  dirName?: string
  error?: string
}

function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`${feature} requires the Electron desktop runtime`)
  return desktop
}

/** 每次调用主进程都重扫技能目录（pi 的加载器，async）：刚导入/删除的技能这一次就是新的。 */
export async function listWorkbenchSkills(): Promise<SkillListItemDto[]> {
  return (await requireDesktopRuntime('skill library').skill.list()) as SkillListItemDto[]
}

export function exportWorkbenchSkill(dirName: string): Promise<unknown> {
  return requireDesktopRuntime('skill export').skill.exportPackage(dirName)
}

export function importWorkbenchSkill(payload: unknown): SkillImportResultDto {
  return requireDesktopRuntime('skill import').skill.importPackage(payload) as SkillImportResultDto
}

/** 删除一个用户技能（内置只读、删不掉，后端会拒）。 */
export function deleteWorkbenchSkill(dirName: string): SkillDeleteResultDto {
  return requireDesktopRuntime('skill delete').skill.deleteByDir(dirName) as SkillDeleteResultDto
}
