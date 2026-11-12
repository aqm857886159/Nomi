import { z } from 'zod'
import { STORYBOARD_DESIGN_STATUSES } from '../../workbenchTypes'
import { storyboardDraftPlanSchema } from '../../generationCanvas/agent/storyboardPlanSchema'

/**
 * 一份分镜设计能不能存进项目的**唯一判据**（草稿面）。
 *
 * 三处共用这一份，不许各抄一份：
 *   ① store 的写入口（`setStoryboardPlan` / `addStoryboardDesign` / `restoreStoryboardDesign`）——不过就不写；
 *   ② 存盘（`projectNormalize`）——兜底，坏的那一项隔离、其余照存；
 *   ③ 读盘（`normalizeRecord`）——盘上已有不合格的一项，项目照常打开，那一项进隔离区。
 * 写入口挡住之后，②③ 在正常情况下一次都不会触发（设计卡 ★9 A1–A3 / A5）。
 */
export const storyboardDesignSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  title: z.string(),
  plan: storyboardDraftPlanSchema,
  committed: z.boolean(),
  status: z.enum(STORYBOARD_DESIGN_STATUSES),
  sourceDocumentUpdatedAt: z.number().finite(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
})

/** 一处不合格：`path` 是字段路径（`shots[2].durationSec`），`problem` 是人话（不带收到的值，也不是 zod 原文）。 */
export type SchemaFieldIssue = Readonly<{ path: string; problem: string }>

type RawIssue = { path: PropertyKey[]; code: string; message: string; expected?: string; received?: string; unionErrors?: readonly { issues: readonly RawIssue[] }[] }

/** `['shots', 2, 'durationSec']` → `shots[2].durationSec`。 */
export function fieldPathText(path: readonly PropertyKey[]): string {
  return path.reduce<string>((text, part) => (typeof part === 'number'
    ? `${text}[${part}]`
    : text ? `${text}.${String(part)}` : String(part)), '') || '(root)'
}

function leaves(issues: readonly RawIssue[]): readonly RawIssue[] {
  return issues.flatMap(issue => (issue.unionErrors ? issue.unionErrors.flatMap(branch => leaves(branch.issues)) : [issue]))
}

/** 只说「要什么」，不回显用户 / 模型写的值（值可能是私有内容）。 */
function problemOf(issue: RawIssue): string {
  if (issue.code === 'invalid_type') {
    return issue.received === 'undefined' ? `is required (${issue.expected})` : `needs ${issue.expected}, got ${issue.received}`
  }
  if (issue.code === 'invalid_enum_value' || issue.code === 'invalid_literal') {
    return issue.message.replace(/, received .*$/, '')
  }
  if (issue.code === 'too_small' || issue.code === 'too_big' || issue.code === 'not_finite') return issue.message
  return issue.message
}

export function issuesOfZodError(issues: readonly RawIssue[], limit = 8): SchemaFieldIssue[] {
  const seen = new Set<string>()
  const out: SchemaFieldIssue[] = []
  for (const issue of leaves(issues)) {
    const path = fieldPathText(issue.path)
    const key = `${path}|${issue.code}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path, problem: problemOf(issue) })
    if (out.length >= limit) break
  }
  return out
}

export function storyboardDesignIssues(design: unknown): SchemaFieldIssue[] {
  const parsed = storyboardDesignSchema.safeParse(design)
  return parsed.success ? [] : issuesOfZodError(parsed.error.issues as readonly RawIssue[])
}

/** 只校验方案（Agent 写口用它回「哪个字段、要什么」）。 */
export function storyboardPlanIssues(plan: unknown): SchemaFieldIssue[] {
  const parsed = storyboardDraftPlanSchema.safeParse(plan)
  return parsed.success ? [] : issuesOfZodError(parsed.error.issues as readonly RawIssue[])
}

/** 写给模型读的一句话：哪些字段、要什么、状态没变。 */
export function storyboardRejectionText(issues: readonly SchemaFieldIssue[]): string {
  return `The storyboard plan was not saved; nothing changed. Fix these fields and send it again: ${issues.map(issue => `${issue.path} ${issue.problem}`).join('; ')}.`
}
