import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { draftCardHidden } from '../../electron/shared/productionGenerationPresentation'
import { createProductionRunRepository } from '../../electron/productionRun/productionRunRepository'
import { draftFixture, seedDraftFixture } from './agent-param-eval-fixtures.mjs'
import { readRunJsons } from './agent-param-eval-collect.mjs'
import { planShotsFromRuns } from './agent-param-eval-judge.mjs'

describe('固定草稿前提', () => {
  it.each([1, 3, 6])('%i 镜夹具由真实 production repository 和评测读口读回', (count) => {
    const dir = makeTempDir('param-eval-fixture-')
    fs.mkdirSync(path.join(dir, '.nomi'), { recursive: true })
    const file = path.join(dir, '.nomi/project.json')
    const original = JSON.stringify({ id: 'isolated', revision: 1, payload: { generationCanvas: { nodes: draftFixture(count).nodes } } })
    fs.writeFileSync(file, original)
    const seeded = seedDraftFixture(dir, count)
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    const repository = createProductionRunRepository({ projectDirResolver: (id) => id === 'isolated' ? dir : null })
    const run = repository.read('isolated', seeded.runId)
    expect(run.generationPlan.shots).toHaveLength(count)
    expect(run.jobs).toEqual([])
    expect(draftCardHidden(run.generationPlan)).toBe(true)
    expect(run.generationPlan.presentations).toEqual([])
    expect(run.budget.actual).toBe(0)
    const read = readRunJsons(dir)
    expect(read.unreadable).toEqual([])
    expect(planShotsFromRuns(read.runs)).toHaveLength(count)
    const project = JSON.parse(fs.readFileSync(path.join(dir, '.nomi/project.json')))
    expect(project.payload.generationCanvas.nodes.map((node) => node.meta.productionShotId)).toEqual(run.generationPlan.shots.map((shot) => shot.shotId))
    expect(run.generationPlan.shots.every((shot) => shot.candidate.parameters.duration === 5)).toBe(true)
  })
  it('没有登记的规模不写盘', () => expect(() => seedDraftFixture('/unused', 2)).toThrow('Unknown draft fixture size'))
})
