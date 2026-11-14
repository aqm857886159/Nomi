// Fixed native storage, seeded only into the walk's closed, isolated project.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = JSON.parse(fs.readFileSync(path.join(here, 'agent-param-eval-fixtures/draft-run.json'), 'utf8'))

export function draftFixture(count) {
  if (![1, 3, 6].includes(count)) throw new Error('Unknown draft fixture size')
  const run = structuredClone(source)
  run.generationPlan.shots = run.generationPlan.shots.slice(0, count)
  const nodes = run.generationPlan.shots.map((shot, index) => ({
    id: shot.nodeId, kind: 'video', categoryId: 'shots', title: shot.title, prompt: shot.candidate.prompt,
    position: { x: 120 + (index % 3) * 460, y: 120 + Math.floor(index / 3) * 320 },
    size: { width: 420, height: 260 }, status: 'idle',
    meta: { modelKey: shot.candidate.modelId, modelVendor: shot.candidate.providerId,
      ...shot.candidate.parameters, productionRunId: run.runId, productionShotId: shot.shotId,
      productionCandidateId: shot.candidate.candidateId, productionCandidateRevision: 1,
      productionCandidateModelKey: shot.candidate.modelId, productionCandidateModelVendor: shot.candidate.providerId },
  }))
  return { run, nodes }
}

export function seedDraftFixture(projectDir, count) {
  const { run, nodes } = draftFixture(count)
  const project = JSON.parse(fs.readFileSync(path.join(projectDir, '.nomi/project.json'), 'utf8'))
  run.projectId = project.id
  const dir = path.join(projectDir, '.nomi/runs', run.runId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'events.ndjson'), JSON.stringify({
    schemaVersion: 1, eventId: 'evt-param-fixture', cursor: 1, runId: run.runId, runRevision: 0,
    commandId: `generation.create:${run.runId}`, type: 'run.created', message: 'parameter evaluation fixture',
    emittedAt: run.updatedAt, stageId: 'generate', payload: { run },
  }) + '\n')
  return { projectId: project.id, nodeIds: nodes.map((node) => node.id), runId: run.runId }
}
