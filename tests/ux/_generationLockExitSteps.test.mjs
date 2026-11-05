import { beforeEach, expect, it, vi } from 'vitest'
import { FIXTURE_TEXT_MODEL_LABEL } from './agent-runtime-fixture.mjs'
import { assertPaidRunAllowed, lockSpendToModels } from './_paidRun.mjs'

vi.mock('./agent-runtime-walk-support.mjs', async importOriginal => ({
  chooseAssistantModel: vi.fn(), sendCreation: vi.fn(), readProject: vi.fn(),
  openCanvas: vi.fn(), CREATION_PANEL: (await importOriginal()).CREATION_PANEL,
}))
import { readProject, chooseAssistantModel, sendCreation } from './agent-runtime-walk-support.mjs'
import { generationLockExitJourney, prepareLockExitStoryboard, lockExitFixtureInput } from './_generationLockExitSteps.mjs'

const project = { projectId: 'project-lock-exit', projectRoot: '/isolated/project', name: 'Lock exit' }
const design = { id: 'plan-lock-exit', plan: { anchors: [{}, {}], shots: [{}, {}, {}] } }
const record = { id: project.projectId, payload: { storyboardDesignsByDocumentId: { doc: [design] } } }
const input = () => ({ page: {}, projectId: project.projectId, model: { vendorKey: 'fixture', modelKey: 'image' } })
beforeEach(() => { vi.resetAllMocks(); readProject.mockResolvedValue(record) })

it('rejects the original paid project.id before reading or drafting', async () => {
  await expect(prepareLockExitStoryboard({ ...input(), projectId: project.id })).rejects.toThrow('projectId 必须是非空字符串')
  expect(readProject).not.toHaveBeenCalled()
  expect(chooseAssistantModel).not.toHaveBeenCalled()
  expect(sendCreation).not.toHaveBeenCalled()
})

it.each([null, '', '  ', 42])('rejects invalid projectId %j at the shared entry', async projectId => {
  await expect(prepareLockExitStoryboard({ ...input(), projectId })).rejects.toThrow('projectId 必须是非空字符串')
  expect(readProject).not.toHaveBeenCalled()
})

it.each([['missing', null, '项目不存在'], ['wrong identity', { ...record, id: 'project-other' }, '项目 ID 不匹配']])('rejects %s before drafting', async (_name, value, message) => {
  readProject.mockResolvedValue(value)
  await expect(prepareLockExitStoryboard(input())).rejects.toThrow(message)
  expect(readProject).toHaveBeenCalledTimes(1)
  expect(sendCreation).not.toHaveBeenCalled()
})

it('does not turn a missing polling record into an unfinished plan', async () => {
  readProject.mockResolvedValueOnce(record).mockResolvedValue(null)
  await expect(prepareLockExitStoryboard(input())).rejects.toThrow('项目不存在')
  expect(readProject).toHaveBeenCalledTimes(2)
})

it('returns the persisted plan for a matching project', async () => {
  await expect(prepareLockExitStoryboard(input())).resolves.toEqual(design)
  expect(readProject).toHaveBeenCalledWith(input().page, project.projectId)
  expect(sendCreation).toHaveBeenCalledTimes(1)
})

it('fails the full journey before starting heartbeat or idle observation', async () => {
  await expect(generationLockExitJourney({ ...input(), projectId: project.id })).rejects.toThrow('projectId 必须是非空字符串')
  expect(readProject).not.toHaveBeenCalled()
})

it('wires the paid and free preparation through the same fixture input', () => {
  const fixture = { expectText() {}, respond() {} }
  const wired = lockExitFixtureInput(project, fixture)
  expect(wired).toEqual({ projectId: project.projectId, fixture, textLabel: FIXTURE_TEXT_MODEL_LABEL })
  expect(wired.fixture).toBe(fixture)
  expect(lockExitFixtureInput({ ...project, id: 'wrong-id' }, fixture).projectId).toBe(project.projectId)
})

it('refuses absent spend opt-in before checking running apps or profile data', () => {
  const isNomiRunning = vi.fn(() => { throw new Error('must not inspect running apps') })
  expect(() => assertPaidRunAllowed('generation-lock-exit-real.paid.mjs', {}, isNomiRunning, {})).toThrow('NOMI_SPEND_OK')
  expect(isNomiRunning).not.toHaveBeenCalled()
})

it('keeps fixture text alongside authorized images while disabling other images', async () => {
  const image = { vendorKey: 'authorized', modelKey: 'image', kind: 'image', enabled: true, availability: { usable: true } }
  const text = { vendorKey: 'fixture', modelKey: 'text', kind: 'text', enabled: true }
  const other = { vendorKey: 'other', modelKey: 'image', kind: 'image', enabled: true }
  const rows = [image, text, other]
  const previous = globalThis.window
  globalThis.window = { nomiDesktop: { modelCatalog: {
    listModels: async () => rows,
    upsertModel: update => Object.assign(rows.find(row => row.vendorKey === update.vendorKey && row.modelKey === update.modelKey), update),
  } } }
  try {
    await expect(lockSpendToModels({ evaluate: (fn, arg) => fn(arg) }, [image])).resolves.toBe(1)
    expect([text.enabled, image.enabled, other.enabled]).toEqual([true, true, false])
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
})
