// Agent 发起的**真视频**付费走查共用的三件事（agent-video-landing.paid.mjs / agent-queued-shots.paid.mjs）：
// 被授权的那一档是什么、花钱前怎么核对 Agent 写的草稿、落地后怎么核对那段真 mp4。
//
// 为什么花钱前必须核对草稿：Seedance 2.0 在 Nomi 里的默认参数是 720p · 5 秒 · 带音频（archetypeWireDefaults），
// 比被授权的 480p · 4 秒 · 无音频贵出好几倍。模型漏写一个字段，花的就是默认那一档。
// 所以卡摆出来之后、按下去之前，先读落盘的制作 Run（宿主真正会派发的那一份），不对就关卡、一分钱不花。
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'

export const BRAIN = { vendorKey: 'apimart', modelKey: 'deepseek-v3.2' }
export const VIDEO = { vendorKey: 'apimart', modelKey: 'doubao-seedance-2.0' }
/**
 * 被授权的那一档（Seedance 2.0 fast · 480p · 4 秒 · 无音频），像真人一样说给模型听。
 *
 * 2026-09-26 真机实测（Windows，DeepSeek V3.2）：Agent 这条路上**选不到 fast**——`draft_shots` 的模型面没有
 * variantId（`candidate` 里写了也被静默剥掉），宿主按目录模型名 `doubao-seedance-2.0` 推成 standard 档；
 * 付费卡上的「变体」却显示 Fast。所以下面 `cheapVideoProblems` 的核对在今天会拦下这一笔（一分钱不花），
 * 这是产品缺陷的证据，不是走查写错。
 */
export const CHEAP_VIDEO_TERMS = 'apimart 的 Seedance 2.0 Fast（doubao-seedance-2.0 的 fast 变体），文生视频，'
  + '480p、4 秒、不要音频（duration=4、resolution=480p、generate_audio=false）。只起草一次'
const FAST_WIRE_MODEL = 'doubao-seedance-2.0-fast'

/** Run 里宿主会派发的每一镜（多镜形态读 shots[]，单镜旧形态读顶层 candidate）。 */
export function plannedShots(run) {
  const plan = run?.generationPlan
  if (!plan) return []
  if (plan.shots?.length) return plan.shots.filter((shot) => shot.included !== false).map((shot) => ({ shotId: shot.shotId, candidate: shot.candidate }))
  return plan.candidate ? [{ shotId: plan.candidate.candidateId, candidate: plan.candidate }] : []
}

/** 这一镜要花的钱是不是被授权的那一档；返回问题清单（空 = 可以按）。 */
export function cheapVideoProblems(candidate) {
  const problems = []
  const params = candidate?.parameters ?? {}
  if (candidate?.providerId !== VIDEO.vendorKey || candidate?.modelId !== VIDEO.modelKey) problems.push(`模型是 ${candidate?.providerId}/${candidate?.modelId}`)
  // 变体三处各自核对：宿主真正发出去的线上模型（transportModelId）、它记下的变体、以及 parameters 里的 model。
  // 任何一处不是 fast 都不按——三者不一致本身就说明宿主会按另一档派发。
  if (candidate?.transportModelId !== undefined && candidate.transportModelId !== FAST_WIRE_MODEL) problems.push(`线上模型是 ${candidate.transportModelId}`)
  if (candidate?.variantId !== undefined && candidate.variantId !== 'fast') problems.push(`variantId 是 ${candidate.variantId}`)
  if (params.model !== undefined && params.model !== FAST_WIRE_MODEL) problems.push(`parameters.model 是 ${params.model}`)
  if (candidate?.transportModelId !== FAST_WIRE_MODEL && candidate?.variantId !== 'fast') problems.push('草稿里没有任何一处写明 fast 档')
  if (Number(params.duration) !== 4) problems.push(`duration 是 ${JSON.stringify(params.duration)}`)
  if (String(params.resolution ?? '').toLowerCase() !== '480p') problems.push(`resolution 是 ${JSON.stringify(params.resolution)}`)
  if (params.generate_audio !== false) problems.push(`generate_audio 是 ${JSON.stringify(params.generate_audio)}`)
  return problems
}

/**
 * 画布节点那一侧的同一道核对：分镜表「生成镜 N」走的是画布执行器，派发按**节点 meta**（`archetype.variantId`
 * 与 meta 上的参数），不按制作 Run 里的草稿候选。所以分镜表那条路要在确认框弹出时核对节点，而不是 Run。
 */
export function cheapVideoNodeProblems(meta) {
  const problems = []
  const modelKey = meta?.modelKey
  if (meta?.modelVendor !== VIDEO.vendorKey || (modelKey !== VIDEO.modelKey && modelKey !== FAST_WIRE_MODEL)) problems.push(`模型是 ${meta?.modelVendor}/${modelKey}`)
  if (modelKey !== FAST_WIRE_MODEL && meta?.archetype?.variantId !== 'fast') problems.push(`变体是 ${meta?.archetype?.variantId}`)
  if (Number(meta?.duration) !== 4) problems.push(`duration 是 ${JSON.stringify(meta?.duration)}`)
  if (String(meta?.resolution ?? '').toLowerCase() !== '480p') problems.push(`resolution 是 ${JSON.stringify(meta?.resolution)}`)
  if (meta?.generate_audio !== false) problems.push(`generate_audio 是 ${JSON.stringify(meta?.generate_audio)}`)
  return problems
}

/**
 * 节点结果地址（`nomi-local://asset/<projectId>/<相对路径>`）→ 项目里那份真文件 → ffprobe 实测。
 * 只认这个项目自己的文件（路径逃不出项目根）。
 */
export async function probeLandedMedia(projectRoot, projectId, rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'nomi-local:' || url.hostname !== 'asset') throw new Error(`结果不是项目素材库的永久地址：${rawUrl}`)
  const [ownerId, ...parts] = url.pathname.slice(1).split('/').map(decodeURIComponent)
  if (ownerId !== projectId) throw new Error(`结果属于别的项目：${ownerId}`)
  const filePath = fs.realpathSync(path.resolve(projectRoot, ...parts))
  const relative = path.relative(fs.realpathSync(projectRoot), filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`结果文件逃出了项目根：${filePath}`)
  const { probeMediaMetadata } = tsxRequire('../../electron/export/mediaProbe.ts', import.meta.url)
  return { filePath, bytes: fs.statSync(filePath).size, probe: await probeMediaMetadata(filePath) }
}
