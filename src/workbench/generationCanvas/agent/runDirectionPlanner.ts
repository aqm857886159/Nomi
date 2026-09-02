// B1 方向门候选规划师（production.plan-directions 的渲染层实现）。
// driver 侧 proposeDirections 停在 awaiting_direction 时，会让渲染层拟 2-3 个「创意方向」候选，
// 供用户在方向门三选一（每个候选：短标题 + 一句话描述）。
//
// 通道选型：走**无工具**的一次性文本链路（single-shot text capability），
// 不用 storyboard 那套画布 agent 工具循环——方向候选是纯文本产出，不碰画布、不花生成额度。
// 参照 shotVerifyJudge.ts 的轻量判断通道（独立会话键 + 助手模型偏好 + mode:'chat'）。
//
// 分工：组 prompt / 解析候选是纯函数（可裸测）；真正调模型的副作用在 runDirectionPlanner 里。
// 失败（模型不可用 / 输出非法 / 不足 2 个候选）一律**抛错**冒泡给 driver，driver catch 后走
// 既有 gate title/summary 兜底——绝不静默编造候选（诚实降级，D4）。

import { z } from 'zod'
import { directionSessionKey } from '../../ai/agentSessionKey'
import { runSingleShotAgent } from '../../ai/agentLoopMode'
import { readWindowUrlParam } from '../../windowUrlParam'

export type DirectionCandidate = { key: string; title: string; oneLiner: string }

/** driver 透传来的 brief（形状同 ProductionBrief，这里只取组 prompt 需要的字段，容忍缺省）。 */
export type DirectionPlannerBrief = {
  goal?: string
  audience?: string
  channel?: string
  tone?: string
  durationSeconds?: number
  sellingPoints?: string[]
}

export type RunDirectionPlannerInput = {
  projectId?: string
  brief?: DirectionPlannerBrief | null
  /** playbook 声明（key/name 等），用于给模型「这是哪类片子」的上下文；结构宽松，只读取文本字段。 */
  playbook?: Record<string, unknown> | null
}

/** 把 brief 里有值的字段拼成人话上下文行（缺省字段不占位，避免喂模型一堆 undefined）。 */
function briefContextLines(brief: DirectionPlannerBrief | null | undefined): string[] {
  const b = brief ?? {}
  const lines: string[] = []
  if (b.goal) lines.push(`目标：${b.goal}`)
  if (b.audience) lines.push(`受众：${b.audience}`)
  if (b.channel) lines.push(`投放渠道：${b.channel}`)
  if (b.tone) lines.push(`调性：${b.tone}`)
  if (typeof b.durationSeconds === 'number' && b.durationSeconds > 0) lines.push(`时长：约 ${b.durationSeconds} 秒`)
  if (Array.isArray(b.sellingPoints) && b.sellingPoints.length) {
    lines.push(`卖点：${b.sellingPoints.filter((s) => typeof s === 'string' && s.trim()).join('、')}`)
  }
  return lines
}

function playbookLabel(playbook: Record<string, unknown> | null | undefined): string {
  if (!playbook) return ''
  const name = typeof playbook.name === 'string' ? playbook.name.trim() : ''
  const key = typeof playbook.key === 'string' ? playbook.key.trim() : ''
  return name || key
}

/**
 * 组方向候选 prompt（纯函数）。语言铁律：**用与 brief 相同的语言**写候选（brief 中文就写中文，
 * 不固定英文）——R15 精神：产出内容跟随项目语言。要求模型只吐一个 JSON，含 2-3 个候选。
 */
export function buildDirectionPlannerPrompt(input: RunDirectionPlannerInput): string {
  const label = playbookLabel(input.playbook)
  const contextLines = briefContextLines(input.brief)
  return [
    '你是一位资深创意总监。下面是一支短视频的创作简报，请为它构思 2-3 个**差异化的创意方向**，供创作者三选一。',
    label ? `片子类型：${label}` : '',
    '',
    '创作简报：',
    ...(contextLines.length ? contextLines : ['（简报信息较少，请基于目标合理发挥）']),
    '',
    '要求：',
    '- 给出 2 到 3 个方向，彼此在切入角度/基调/表现手法上要**明显不同**（不要三个近义方案）。',
    '- 每个方向：一个简短标题（不超过 12 个字）+ 一句话描述（说清这个方向长什么样、怎么打动受众）。',
    '- **用与上面简报相同的语言**书写标题和描述（简报是中文就用中文，是英文就用英文），不要固定用英文。',
    '- key 用简短的英文小写标识（如 documentary / kinetic / minimal），仅用字母数字与连字符。',
    '',
    '只输出一个 JSON 对象，形如：',
    '{"candidates":[{"key":"documentary","title":"标题","oneLiner":"一句话描述"}]}',
    '不要输出 JSON 以外的任何文字。',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// 宽松结构校验：只确认「有 candidates 数组」；单条字段的严格性（非空/合法 key）在归一化循环里逐条过，
// 一两条坏项不整锅报废（与 driver 侧 normalizeDirectionCandidates 的「跳过坏项、末尾才判总数」同构）。
const responseSchema = z.object({ candidates: z.array(z.record(z.string(), z.unknown())) })

/**
 * 容错解析模型输出：剥 ```json 围栏、抓首个 {…}、清裸控制字符与尾逗号，再过 zod。
 * 解析不出对象/无 candidates 数组 → 抛「非法 JSON」；解析出但清洗后不足 2 个可用候选 → 抛「少于两个」。
 * 两类失败都冒泡给 driver 走兜底（不静默当空、不编造）。
 * 归一化：key 只留 [A-Za-z0-9-]（非法则按序号兜 dir-N）、去重、丢空 title/oneLiner、截断，取前 3 个。
 */
export function parseDirectionCandidates(text: string): DirectionCandidate[] {
  let s = String(text || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const brace = s.match(/\{[\s\S]*\}/)
  const candidate = brace ? brace[0] : s
  // eslint-disable-next-line no-control-regex -- Legacy JSON repair intentionally strips emitted control characters.
  const repaired = candidate.replace(/[\u0000-\u001f]+/g, ' ').replace(/,(\s*[}\]])/g, '$1')
  let parsed: unknown = null
  for (const c of [candidate, repaired]) {
    try {
      parsed = JSON.parse(c)
      break
    } catch {
      /* 试下一种 */
    }
  }
  const result = responseSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`方向候选输出非法 JSON：${candidate.slice(0, 140)}`)
  }
  const seen = new Set<string>()
  const out: DirectionCandidate[] = []
  result.data.candidates.forEach((item, index) => {
    if (out.length >= 3) return
    const rawKey = typeof item.key === 'string' ? item.key.trim() : ''
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const oneLiner = typeof item.oneLiner === 'string' ? item.oneLiner.trim() : ''
    if (!title || !oneLiner) return // 空标题/空描述的坏项直接跳过
    const key = /^[A-Za-z0-9-]{1,40}$/.test(rawKey) ? rawKey : `dir-${index + 1}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ key, title: title.slice(0, 80), oneLiner: oneLiner.slice(0, 200) })
  })
  if (out.length < 2) throw new Error('方向候选少于两个可用项')
  return out
}

/**
 * 一次 ephemeral、零工具的方向规划，再由原领域 schema 解析候选。
 * 返回 { candidates }，形状与 driver 期待一致（productionRunDriverOps.normalizeDirectionCandidates 再清一遍）。
 */
export async function runDirectionPlanner(
  input: RunDirectionPlannerInput,
): Promise<{ candidates: DirectionCandidate[] }> {
  const projectId = input.projectId ?? readWindowUrlParam('projectId') ?? ''
  const response = await runSingleShotAgent({
    featureKey: directionSessionKey(projectId),
    prompt: buildDirectionPlannerPrompt(input),
    displayPrompt: '构思创意方向',
    ...(projectId ? { projectId } : {}),
    skillKey: 'workbench.production.direction-planner',
    skillName: '方向候选规划',
  })
  const candidates = parseDirectionCandidates(response.text ?? '')
  return { candidates }
}
