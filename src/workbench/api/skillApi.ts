// 渲染层调 skill IPC 的唯一入口（镜像 modelCatalogApi 的 requireDesktopRuntime 范式）。
// 能力派生的「权威逻辑」在 electron（deriveSkillNeeds 算 neededProviders 进 DTO）；这里只做
// 「needs − available」的平凡差集，不重复派生逻辑（P1）。
import { getDesktopBridge, type DesktopBridge } from '../../desktop/bridge'
import { getWorkbenchModelCatalogHealth } from './modelCatalogApi'

export type SkillProviderKind = 'text' | 'image' | 'video'

export type SkillListItemDto = {
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
}

export type SkillImportResultDto = {
  ok: boolean
  dirName?: string
  skillName?: string
  error?: string
}

export type SkillDeleteResultDto = {
  ok: boolean
  dirName?: string
  error?: string
}

function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`${feature} requires the Electron desktop runtime`)
  return desktop
}

export function listWorkbenchSkills(): SkillListItemDto[] {
  return requireDesktopRuntime('skill library').skill.list() as SkillListItemDto[]
}

export function exportWorkbenchSkill(dirName: string): unknown {
  return requireDesktopRuntime('skill export').skill.exportPackage(dirName)
}

export function importWorkbenchSkill(payload: unknown): SkillImportResultDto {
  return requireDesktopRuntime('skill import').skill.importPackage(payload) as SkillImportResultDto
}

/** 删除一个用户技能（内置只读、删不掉，后端会拒）。 */
export function deleteWorkbenchSkill(dirName: string): SkillDeleteResultDto {
  return requireDesktopRuntime('skill delete').skill.deleteByDir(dirName) as SkillDeleteResultDto
}

/** 当前已接入且 enabled 的模型模态集合（text/image/video；过滤掉 audio——skill 不声明 audio）。 */
export async function getAvailableSkillProviders(): Promise<Set<SkillProviderKind>> {
  const health = await getWorkbenchModelCatalogHealth()
  const set = new Set<SkillProviderKind>()
  for (const k of health.byKind) {
    if (k.enabledModels > 0 && (k.kind === 'text' || k.kind === 'image' || k.kind === 'video')) {
      set.add(k.kind)
    }
  }
  return set
}

export type SkillCapability = {
  needs: SkillProviderKind[]
  missing: SkillProviderKind[]
  satisfied: boolean
}

/** 平凡差集：skill 声明需要的模态里，当前实例缺哪些 → 缺啥清单（缺 = ⚠️ 去接入）。 */
export function skillCapabilityFor(
  item: Pick<SkillListItemDto, 'neededProviders'>,
  available: ReadonlySet<SkillProviderKind>,
): SkillCapability {
  const missing = item.neededProviders.filter((p) => !available.has(p))
  return { needs: item.neededProviders, missing, satisfied: missing.length === 0 }
}

const PROVIDER_LABEL: Record<SkillProviderKind, string> = { text: '文本', image: '图像', video: '视频' }
export function providerLabel(kind: SkillProviderKind): string {
  return PROVIDER_LABEL[kind] ?? kind
}
