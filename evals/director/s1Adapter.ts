import { compileDirectorPlan, type DirectorCompileIssue } from '../../src/workbench/generationCanvas/nodes/director/model/compiler/directorPlanCompiler'
import { planDirector, type PlannerResult } from '../../src/workbench/generationCanvas/nodes/director/model/plan/directorPlanner'
import type { SpatialAuditContext } from '../../src/workbench/generationCanvas/nodes/director/model/directorSpatialAudit'
import type { DirectorPlan } from '../../electron/shared/director/directorPlanSchema'

export type S1AdaptedProject = { project: import('../../src/workbench/generationCanvas/nodes/director/model/directorTypes').DirectorProject; actorMap: Record<string, string>; anchors: Record<string, import('../../src/workbench/generationCanvas/nodes/director/model/directorEvalMeasurement').AnchorSpec>; issues: DirectorCompileIssue[]; spatial: SpatialAuditContext }
export type S1AdapterResult = { ok: true; adapted: S1AdaptedProject; planner: Extract<PlannerResult, { ok: true }> } | { ok: false; errors: string[]; planner?: PlannerResult }

export async function adaptS1Prompt(prompt: string): Promise<S1AdapterResult> {
  const planner = await planDirector(prompt)
  if (!planner.ok) return { ok: false, errors: planner.errors, planner }
  const compiled = compileDirectorPlan(planner.plan)
  if (!compiled.ok) return { ok: false, errors: compiled.errors, planner }
  return { ok: true, adapted: { project: compiled.project, actorMap: compiled.actorMap, anchors: compiled.anchors, issues: compiled.issues, spatial: compiled.spatial }, planner }
}

export function adaptS1Plan(plan: DirectorPlan): S1AdaptedProject | { errors: string[] } {
  const compiled = compileDirectorPlan(plan)
  return compiled.ok ? { project: compiled.project, actorMap: compiled.actorMap, anchors: compiled.anchors, issues: compiled.issues, spatial: compiled.spatial } : { errors: compiled.errors }
}

export const S1_SCHEME = 's1' as const
