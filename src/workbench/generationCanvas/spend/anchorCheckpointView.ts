import { buildNomiLocalAssetUrl } from '../../../media/nomiLocalAssetUrl'
import type {
  ProductionArtifact,
  ProductionGenerationShot,
  ProductionJob,
  ProductionRun,
} from '../../../../electron/productionRun/productionRunTypes'

// P4 §3.2 形象确认卡的**只读投影**（纯函数，可单测）：一道 waiting 的 anchor_checkpoint 门 + 它的 Run
// → 「哪些定妆照要过目、每张的缩略图/名称/是新拍还是复用/对应哪个 shotId（重拍要用）」。
// 术语零内部词（「锚/检查点/封存/物化」不进任何返回串——名称从 candidate.prompt 取人话前缀）。
//
// 数据谱系（与 multiShotCanvasLanding 同一条链，不另立第二份）：
//   门 jobIds = 锚 job → job.metadata.shotId → generationPlan.shots(role==='anchor') 取新拍条目；
//   视频镜 candidate.references(role==='character') → 复用条目（按 assetId 去重）；
//   job/asset → artifacts(image·ready/adopted) 取缩略图 → buildNomiLocalAssetUrl 出 nomi-local url。
// 缩略图缺失（文件没落 / 越界路径）→ thumbnailUrl:null（卡渲染占位块，不伪造图）。

export type AnchorCheckpointCardModel = {
  /** run + 门在 view 层已定位；卡组件只读这个模型，不再自己翻 run。 */
  gateId: string
  projectId: string
  runId: string
  /** 已批准硬预算（¥）——说明行「按已批准的 ¥N 预算开拍」用；未知为 null（不伪造金额）。 */
  approvedBudget: number | null
  budgetCurrency: string
  /** 镜头数（非锚、included 的镜）——主按钮「开拍 N 镜」用。 */
  shotCount: number
  anchors: AnchorCardEntry[]
  /** 新拍数 = 卡上本批实际生成、可重拍的形象数。 */
  freshCount: number
  /** 复用上集数 = 各镜引用的已有形象（按 assetId 去重）。 */
  reusedCount: number
}

export type AnchorCardEntry = {
  /** 重拍这张要用（decide rejected + reworkShot(shotId)）。 */
  shotId: string
  /** 人话名称（如「阿澈」）——从 candidate.prompt 取前缀，去掉「定妆照/参考」这类尾巴。 */
  name: string
  /** 角色前缀（「男生」「女生」「场景」…）；无则 undefined，卡上只显 name。 */
  roleLabel?: string
  /** 定妆照缩略图（nomi-local://…）；缺失为 null → 卡渲染占位块。 */
  thumbnailUrl: string | null
  /** 复用条目的项目资产 id；新拍条目没有这个字段。 */
  sourceAssetId?: string
  /** 复用的已有资产不能沿本批的重拍链操作；新拍的 anchor-role shot 可以重拍。 */
  canRework: boolean
  /** true=复用上集（badge=ink-05/ink-60）；false=新拍（badge=accent-soft/accent）。 */
  reused: boolean
}

function safeRelativePath(value: string | undefined): value is string {
  if (!value || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false
  return !value.split(/[\\/]+/).includes('..')
}

/** 从 candidate.prompt 取人话名称：取第一段（换行/句号/顿号前），剥掉角色前缀（「男生 · 」）+ 「定妆照/参考/形象」尾巴，截断。 */
function anchorName(shot: ProductionGenerationShot | undefined): string {
  const raw = shot?.candidate?.prompt?.trim() ?? ''
  if (!raw) return ''
  // 先在句读处断第一段（不含中点·，中点是角色分隔符另处理）。
  const firstSegment = raw.split(/[\n。，,、:：]/)[0]?.trim() ?? raw
  // 剥掉角色前缀：「男生 · 阿澈」→「阿澈」（roleLabel 另出，名称不重复带角色词）。
  const role = anchorRoleLabel(shot)
  let name = firstSegment
  if (role) {
    const prefix = new RegExp(`^${role}\\s*[·・]\\s*`, 'u')
    name = name.replace(prefix, '').trim()
    // 前缀不带中点时（如「男生阿澈」少见）只在开头精确剥一次角色词。
    if (name.startsWith(role) && name.length > role.length) name = name.slice(role.length).trim()
  }
  name = name.replace(/(的)?(定妆照|参考图|参考|形象|设定)$/u, '').trim()
  const result = name || firstSegment
  return result.length > 16 ? `${result.slice(0, 16)}…` : result
}

/**
 * 该形象是否「复用上集」。真相源 = #161 合入的锚复用语义（`mcpMultiShotAnchorReuse.e2e.test.ts`）：
 *
 *   **复用一个已有形象 ≠ role:'anchor' 的 shot**——它没有要生成的东西，只是把项目**已有资产**作
 *   `character` 参考挂到各视频镜的 `candidate.references[]`。调度派生按 role 分区
 *   （`batchScheduleDerivation.ts:212` anchorsOf 只收 role==='anchor'），故复用形象**不进 anchorsOf、
 *   不占提交、也不进锚检查点门的 jobIds**（`deriveCheckpoint` 对纯复用批返回 not_required）。
 *
 * 推论（这条决定了判据落在哪一层）：门里的 job 条目按构造是本批新生成的 anchor-role shot；
 * 复用形象则从视频镜的 `references` 反查，作为没有重拍动作的复用条目补进卡片。
 */
function anchorReused(shot: ProductionGenerationShot | undefined, _job: ProductionJob | undefined): boolean {
  // role:'anchor' 是本批要实际生成的形象，即使它带有输入参考，也仍是新拍。
  // 复用形象没有自己的 job；它只会作为 character reference 出现在视频镜的 candidate 上。
  return shot?.role !== 'anchor' && Boolean(characterReferencesFor(shot).length)
}

/**
 * 本批「复用上集」的已有形象数：视频镜 `references[]` 里 role==='character' 的**去重 assetId**，
 * 这是 #161 语义下唯一可靠的复用真相源（D4：数得出来才显示，数不出来就是 0）。
 */
function characterReferencesFor(shot: ProductionGenerationShot | undefined) {
  return (shot?.candidate?.references ?? []).filter(
    (reference) => reference.role === 'character' && typeof reference.assetId === 'string' && reference.assetId,
  )
}

function reusedAssetReferences(run: ProductionRun) {
  const shots = run.generationPlan?.shots ?? []
  const references = new Map<string, (typeof shots)[number]['candidate']['references'][number]>()
  for (const shot of shots) {
    if (shot.role === 'anchor' || shot.included === false) continue
    for (const reference of characterReferencesFor(shot)) {
      if (!references.has(reference.assetId)) references.set(reference.assetId, reference)
    }
  }
  return [...references.values()]
}

function thumbnailForReference(run: ProductionRun, reference: { assetId: string; contentHash: string }): string | null {
  const artifact = run.artifacts.find(
    (candidate: ProductionArtifact) =>
      (candidate.artifactId === reference.assetId || candidate.contentHash === reference.contentHash) &&
      candidate.kind === 'image' &&
      (candidate.status === 'ready' || candidate.status === 'adopted') &&
      (safeRelativePath(candidate.thumbnailRelativePath) || safeRelativePath(candidate.projectRelativePath)),
  )
  if (!artifact) return null
  const rel = safeRelativePath(artifact.thumbnailRelativePath)
    ? artifact.thumbnailRelativePath
    : artifact.projectRelativePath
  if (!rel) return null
  try {
    return buildNomiLocalAssetUrl(run.projectId, rel)
  } catch {
    return null
  }
}

function thumbnailFor(
  run: ProductionRun,
  jobId: string,
): string | null {
  const artifact = run.artifacts.find(
    (candidate: ProductionArtifact) =>
      candidate.jobId === jobId &&
      candidate.kind === 'image' &&
      (candidate.status === 'ready' || candidate.status === 'adopted') &&
      (safeRelativePath(candidate.thumbnailRelativePath) || safeRelativePath(candidate.projectRelativePath)),
  )
  if (!artifact) return null
  const rel = safeRelativePath(artifact.thumbnailRelativePath)
    ? artifact.thumbnailRelativePath
    : artifact.projectRelativePath
  if (!rel) return null
  try {
    return buildNomiLocalAssetUrl(run.projectId, rel)
  } catch {
    return null
  }
}

/**
 * 从 Run + waiting 的 anchor_checkpoint 门投影出形象确认卡模型。门必须是该 run 的锚检查点门（调用方在
 * view 层用 gateKindOf 判过 'checkpoint' 再调）。返回 null = 门没有可展示的锚（防御，正常不发生）。
 */
export function buildAnchorCheckpointCard(
  run: ProductionRun,
  gate: { gateId: string; jobIds: string[] },
): AnchorCheckpointCardModel | null {
  const jobById = new Map(run.jobs.map((job) => [job.jobId, job]))
  const shotById = new Map((run.generationPlan?.shots ?? []).map((shot) => [shot.shotId, shot]))

  const anchors: AnchorCardEntry[] = []
  for (const jobId of gate.jobIds) {
    const job = jobById.get(jobId)
    const shotId = typeof job?.metadata?.shotId === 'string' ? (job.metadata.shotId as string) : undefined
    const shot = shotId ? shotById.get(shotId) : undefined
    // shotId 是重拍的必需键（reworkShot 按 shotId）；拿不到就跳过这张（不放一张点了没反应的卡，C1 契约）。
    if (!shotId) continue
    const reused = anchorReused(shot, job)
    anchors.push({
      shotId,
      name: anchorName(shot),
      ...(anchorRoleLabel(shot) ? { roleLabel: anchorRoleLabel(shot) } : {}),
      thumbnailUrl: thumbnailFor(run, jobId),
      reused,
      canRework: !reused,
    })
  }
  if (anchors.length === 0) return null

  // 复用形象没有 anchor-role job，因而不会出现在 gate.jobIds。把每个项目资产只投影一次，
  // 让卡上的「新拍 / 复用上集」徽标与真实计划一致；这些条目不挂重拍动作。
  for (const reference of reusedAssetReferences(run)) {
    anchors.push({
      shotId: `reuse:${reference.assetId}`,
      name: '',
      thumbnailUrl: thumbnailForReference(run, reference),
      sourceAssetId: reference.assetId,
      reused: true,
      canRework: false,
    })
  }

  const shots = (run.generationPlan?.shots ?? []).filter((shot) => shot.role !== 'anchor' && shot.included !== false)
  const freshCount = anchors.filter((anchor) => !anchor.reused).length
  const reusedCount = anchors.length - freshCount

  return {
    gateId: gate.gateId,
    projectId: run.projectId,
    runId: run.runId,
    approvedBudget: Number.isFinite(run.budget.authorized) && run.budget.authorized > 0 ? run.budget.authorized : null,
    budgetCurrency: run.budget.currency || 'CNY',
    shotCount: shots.length,
    anchors,
    freshCount,
    reusedCount,
  }
}

/** 角色前缀：优先 shot.candidate.parameters.roleLabel（driver 若填了），否则从 prompt 里嗅「男生/女生/场景/道具」。
 *  嗅不到返回空（卡上只显名称，不硬塞）。零内部词。 */
function anchorRoleLabel(shot: ProductionGenerationShot | undefined): string | undefined {
  const explicit = shot?.candidate?.parameters?.['roleLabel']
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  const prompt = shot?.candidate?.prompt ?? ''
  for (const [needle, label] of [
    ['女生', '女生'], ['女孩', '女生'], ['女主', '女生'],
    ['男生', '男生'], ['男孩', '男生'], ['男主', '男生'],
    ['场景', '场景'], ['背景', '场景'],
    ['道具', '道具'],
  ] as const) {
    if (prompt.includes(needle)) return label
  }
  return undefined
}
