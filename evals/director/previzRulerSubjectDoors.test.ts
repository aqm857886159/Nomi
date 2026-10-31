import { describe, expect, it } from 'vitest'
import { normalizeDirectorPlan, parseDirectorPlan } from '../../electron/shared/director/directorPlanSchema'
import { compileDirectorPlan } from '../../src/workbench/generationCanvas/nodes/director/model/compiler/directorPlanCompiler'
import { normalizeDirectorProject } from '../../src/workbench/generationCanvas/nodes/director/model/directorProject'
import { summarizeDirectorShots } from '../../src/workbench/generationCanvas/nodes/director/model/directorShotSummaries'
import { createDirectorStore } from '../../src/workbench/generationCanvas/nodes/director/model/directorStore'
import type { DirectorProject, DirectorScene } from '../../src/workbench/generationCanvas/nodes/director/model/directorTypes'
import { fingerprintDirectorProject, overlayDirectorProject } from '../../src/workbench/generationCanvas/nodes/director/model/planOverrides'
import { PREVIZ_RULER_PLAN } from './previzRulerFixture'
import { S1_ORACLE_PLANS } from './s1OraclePlans'

/**
 * The compiler records each shot camera's measured subject (camera.measurementSubject). That record has to survive every
 * door that rewrites or replays a layer: copy layer, cross-layer copy, import scene, and recompile over hand edits.
 * Every door below is the real store action or the real overlay entry, never the internal helper it happens to call.
 */

function compile(plan: unknown): DirectorProject | null {
  const parsed = parseDirectorPlan(normalizeDirectorPlan(plan))
  if (!parsed.success) return null
  const compiled = compileDirectorPlan(parsed.data)
  return compiled.ok ? (JSON.parse(JSON.stringify(compiled.project)) as DirectorProject) : null
}

/** The three-person street plus every oracle plan that compiles: the population the class check walks. */
const POPULATION = Object.entries({ street: PREVIZ_RULER_PLAN, ...S1_ORACLE_PLANS }).flatMap(([name, plan]) => {
  const project = compile(plan)
  return project ? [{ name, project }] : []
})
const STREET = POPULATION.find((entry) => entry.name === 'street')!.project

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const entityIds = (scene: DirectorScene) => new Set([...scene.objects, ...scene.cameras, ...scene.lights].map((entity) => entity.id))
const labels = (project: DirectorProject) => summarizeDirectorShots(project).map(({ start, end, shotSize, move }) => ({ start, end, shotSize, move }))

type Door = 'duplicateSceneLayer' | 'copyEntitiesToScene' | 'importScene'
const DOORS: Door[] = ['duplicateSceneLayer', 'copyEntitiesToScene', 'importScene']

/**
 * Run one door on a compiled project. `original` is the project before the door (source layer active), `project` is
 * the project after it with the copy layer active.
 */
function copyThroughDoor(door: Door, raw: DirectorProject) {
  const store = createDirectorStore({ rawProject: clone(raw), defaultSceneName: 'S' })
  const original = store.getState().exportProject()
  const source = original.scenes.find((scene) => scene.id === original.activeSceneId)!
  let copyId: string | null
  if (door === 'duplicateSceneLayer') {
    copyId = store.getState().duplicateSceneLayer(source.id, ' copy')
  } else if (door === 'importScene') {
    copyId = store.getState().importScene(clone(source), 'imported')
  } else {
    copyId = store.getState().createSceneLayer('target')
    store.getState().setActiveScene(source.id)
    store.getState().copyEntitiesToScene([...source.objects, ...source.cameras].map((entity) => entity.id), copyId, false)
    store.getState().setActiveScene(copyId)
  }
  const project = store.getState().exportProject()
  const copy = project.scenes.find((scene) => scene.id === copyId)
  if (!copy) throw new Error(`${door} did not produce a layer`)
  expect(project.activeSceneId, `${door} should leave the copy active`).toBe(copy.id)
  return { original, source, project, copy }
}

/** Camera records whose subject is not an object of the camera's own layer. */
function recordsOutsideLayer(scene: DirectorScene): string[] {
  const objectIds = new Set(scene.objects.map((object) => object.id))
  return scene.cameras.flatMap((camera) =>
    camera.measurementSubject && !objectIds.has(camera.measurementSubject.objectId) ? [`${camera.id} -> ${camera.measurementSubject.objectId}`] : [])
}

/**
 * Class check: every field path under `value` whose string equals one of `oldIds` (array indexes folded to `[]`).
 * It never names a field, so a reference field added tomorrow is covered the day it exists.
 */
function staleIdFields(value: unknown, oldIds: ReadonlySet<string>, trail = ''): string[] {
  if (typeof value === 'string') return oldIds.has(value) ? [trail.replace(/\[\d+\]/g, '[]')] : []
  if (Array.isArray(value)) return value.flatMap((item, index) => staleIdFields(item, oldIds, `${trail}[${index}]`))
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, next]) => staleIdFields(next, oldIds, trail ? `${trail}.${key}` : key))
  return []
}

describe.each(DOORS)('the recorded measurement subject follows a copied layer: %s', (door) => {
  it('every copied camera records an object of the copy layer', () => {
    const { source, copy } = copyThroughDoor(door, STREET)
    expect(source.cameras.filter((camera) => camera.measurementSubject).length, 'the street source must carry records').toBeGreaterThanOrEqual(3)
    expect(recordsOutsideLayer(copy), `${door}: a copied camera still records an object that only the source layer has`).toEqual([])
  })

  it('the copy shows the same shot size and camera move as the source layer', () => {
    const { original, project } = copyThroughDoor(door, STREET)
    const expected = labels(original)
    expect(expected, 'a source that measures nothing would make the comparison vacuous').toHaveLength(3)
    expect(expected.every(({ shotSize }) => shotSize !== null)).toBe(true)
    expect(labels(project), `${door}: shot size and camera move must equal the source layer`).toEqual(expected)
  })
})

describe('class check: a copied layer names none of the source layer ids', () => {
  it('the walker reports a planted reference at any depth, whatever the field is called', () => {
    const planted = { cameras: [{ id: 'camera-new', future: { nested: [{ target: 'actor:old' }, { target: 'actor:other' }] } }], name: 'actor:old-ish' }
    expect(staleIdFields(planted, new Set(['actor:old']))).toEqual(['cameras[].future.nested[].target'])
    expect(staleIdFields({ a: 1, b: [null, true, 'x'] }, new Set(['actor:old']))).toEqual([])
  })

  it('the population is real: many compiled layers, each carrying subject records', () => {
    expect(POPULATION.length).toBeGreaterThanOrEqual(25)
    const records = POPULATION.flatMap(({ project }) => project.scenes[0].cameras.filter((camera) => camera.measurementSubject))
    expect(records.length).toBeGreaterThanOrEqual(POPULATION.length)
  })

  it.each(DOORS)('%s: no string anywhere in the copy equals a source entity id, across the whole population', (door) => {
    const failures = new Map<string, Set<string>>()
    for (const { name, project } of POPULATION) {
      const { source, copy } = copyThroughDoor(door, project)
      for (const field of staleIdFields(copy, entityIds(source))) failures.set(field, (failures.get(field) ?? new Set<string>()).add(name))
    }
    expect(Object.fromEntries([...failures].map(([field, plans]) => [field, `${plans.size} plans`])), `${door}: fields that still point at the source layer`).toEqual({})
  })
})

describe('recompiling a damaged subject record', () => {
  const FIRST_CAMERA = 'shot:chase_wide/camera'
  const cameraOf = (project: DirectorProject) => project.scenes[0].cameras.find((camera) => camera.id === FIRST_CAMERA)!

  it('the compiler record comes back, and a real hand adjustment on the same camera still replays', () => {
    const base = fingerprintDirectorProject(STREET)
    const current = normalizeDirectorProject(clone(STREET))
    cameraOf(current).measurementSubject = null
    cameraOf(current).fov = 18
    const edited = clone(PREVIZ_RULER_PLAN)
    edited.shots[0].size = '中景'
    const result = overlayDirectorProject({ compiled: compile(edited)!, current, base, touched: ['shot:chase_wide'] })
    expect(cameraOf(result.project).measurementSubject, 'the damaged record must not be replayed over the compiler value').toEqual({ objectId: 'actor:thief' })
    expect(result.reorderedOverrides.filter((label) => label.endsWith('.measurementSubject')), 'a record is not a hand adjustment').toEqual([])
    expect(cameraOf(result.project).fov, 'the camera hand edit must survive').toBe(18)
    expect(summarizeDirectorShots(result.project)[0].shotSize).not.toBeNull()
  })
})
