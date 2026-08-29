import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildComfyImportModelMapping, buildImportedWorkflow, type ComfyGraph } from './comfyuiWorkflowImport'
import { CURRENT_CATALOG_VERSION, type CatalogState, type Mapping, type Model } from './types'
import { isJsonRecord } from '../jsonUtils'
import { migrateComfyWorkflowOutputs } from './comfyuiWorkflowOutputMigration'

let root = ''
vi.mock('electron', () => ({
  app: { getPath: () => root, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
}))
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-comfy-output-')); vi.resetModules() })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

const graph: ComfyGraph = {
  '1': { class_type: 'LoadImage', inputs: { image: 'author.png' } },
  '2': { class_type: 'UNETLoader', inputs: { unet_name: 'author.safetensors' } },
  '3': { class_type: 'SaveVideo', inputs: { video: ['1', 0] } },
}

function legacyCatalog(): CatalogState {
  const binding = { outputNodeId: '3', outputKind: 'video' as const, firstFrameNodeId: '1', firstFrameInputKey: 'image',
    params: [{ nodeId: '2', inputKey: 'unet_name', paramKey: 'comfy_model', label: 'UNet', type: 'text' as const, default: 'chosen.safetensors' }] }
  const built = buildImportedWorkflow(graph, binding, [{ classType: 'UNETLoader', inputKey: 'unet_name', options: ['chosen.safetensors', 'other.safetensors'] }])
  const { model, mapping } = buildComfyImportModelMapping(built, { modelKey: 'comfy-existing', labelZh: 'User workflow', draft: { text: JSON.stringify(graph), binding } })
  const staleModel = model as Model
  staleModel.kind = 'image'
  staleModel.enabled = false
  staleModel.meta = { ...(isJsonRecord(staleModel.meta) ? staleModel.meta : {}), userSetting: 'keep', comfyWorkflowImport: { text: JSON.stringify(graph), binding: { ...binding, outputKind: 'image' } } }
  const staleMapping = mapping as Mapping
  staleMapping.enabled = true
  staleMapping.taskKind = 'image_edit'
  staleMapping.query!.response_mapping = { image_url: 'image_url', error_message: 'error', custom: 'keep' }
  return { version: 9, vendors: [], apiKeysByVendor: {}, models: [staleModel], mappings: [staleMapping] }
}

function legacyConstructorCatalog(targets: unknown): CatalogState {
  const workflow: ComfyGraph = {
    '1': { class_type: 'EmptyImage', inputs: { width: 64, height: 64, batch_size: 1, color: 0 } },
    '2': { class_type: 'CreateVideo', inputs: { images: ['1', 0], fps: 8 } },
    '3': { class_type: 'SaveVideo', inputs: { video: ['2', 0] } },
    '4': { class_type: 'PreviewImage', inputs: { images: ['1', 0] } },
  }
  const binding = { outputNodeId: '2', outputKind: 'image' as const }
  const built = buildImportedWorkflow(workflow, binding)
  const { model, mapping } = buildComfyImportModelMapping(built, { modelKey: 'comfy-constructor', labelZh: 'Constructor' })
  const staleModel = model as Model
  staleModel.kind = 'image'
  staleModel.meta = { ...model.meta as Record<string, unknown>, comfyWorkflowImport: { text: JSON.stringify(workflow), binding } }
  const staleMapping = mapping as Mapping
  staleMapping.enabled = true
  staleMapping.taskKind = 'text_to_image'
  staleMapping.query!.response_mapping = { image_url: 'image_url', error_message: 'error' }
  staleMapping.create!.body = { prompt: built.templatedGraph, ...(targets === undefined ? {} : { partial_execution_targets: targets }) }
  return { version: 9, vendors: [], apiKeysByVendor: {}, models: [staleModel], mappings: [staleMapping] }
}

describe('stored ComfyUI output correction', () => {
  it('leaves an already-correct model and all of its task-specific custom mappings unchanged', () => {
    const state = legacyCatalog()
    state.models[0].kind = 'video'
    state.models[0].meta = { comfyWorkflowImport: { text: JSON.stringify(graph), binding: { outputNodeId: '3', outputKind: 'video' } } }
    const mapping = state.mappings[0]
    mapping.taskKind = 'text_to_video'
    mapping.query!.response_mapping = { video_url: ['video_url', 'fallback.video'], image_url: 'image_url' }
    mapping.create!.body = { prompt: graph, partial_execution_targets: ['3', 'preview'] }
    state.mappings.push({ ...mapping, taskKind: 'image_to_video', create: { ...mapping.create!, body: { prompt: { '99': graph['3'] }, partial_execution_targets: ['99'] } } })
    expect(migrateComfyWorkflowOutputs(structuredClone(state))).toEqual(state)
  })

  it.each(['custom media path', 'extra media field', 'different graph', 'different input mode', 'existing target task'])(
    'does not overwrite a stale model mapping with %s', (scenario) => {
      const state = legacyCatalog()
      const mapping = state.mappings[0]
      if (scenario === 'custom media path') mapping.query!.response_mapping = { image_url: ['image_url', 'fallback.image'] }
      if (scenario === 'extra media field') mapping.query!.response_mapping = { image_url: 'image_url', video_url: 'custom.video' }
      if (scenario === 'different graph') mapping.create!.body = { prompt: { '99': graph['3'] }, partial_execution_targets: ['99'] }
      if (scenario === 'different input mode') mapping.taskKind = 'text_to_image'
      if (scenario === 'existing target task') state.mappings.push({ ...structuredClone(mapping), taskKind: 'image_to_video', query: { ...mapping.query!, response_mapping: { video_url: 'custom.video' } } })
      const result = migrateComfyWorkflowOutputs(structuredClone(state))
      if (scenario === 'existing target task') expect(result.models[0].kind).toBe('video')
      else expect(result.models).toEqual(state.models)
      expect(result.mappings).toEqual(state.mappings)
      expect(migrateComfyWorkflowOutputs(result)).toEqual(result)
    },
  )

  it('preserves custom execution targets when only the output kind was stale', () => {
    const state = legacyCatalog()
    state.mappings[0].create!.body = { ...(state.mappings[0].create!.body as Record<string, unknown>), partial_execution_targets: ['3', '2'], custom: 'keep' }
    const result = migrateComfyWorkflowOutputs(state)
    expect(result.mappings[0].taskKind).toBe('image_to_video')
    expect(result.mappings[0].create).toEqual(state.mappings[0].create)
  })

  it('does not strand an enabled model behind a disabled target mapping', () => {
    const state = legacyCatalog()
    state.models[0].enabled = true
    state.mappings.push({ ...structuredClone(state.mappings[0]), taskKind: 'image_to_video', enabled: false, query: { ...state.mappings[0].query!, response_mapping: { video_url: 'video_url' } } })
    expect(migrateComfyWorkflowOutputs(structuredClone(state))).toEqual(state)
  })

  it('repairs a canonical legacy CreateVideo target and remains idempotent', () => {
    const state = legacyCatalog()
    const workflow: ComfyGraph = { ...graph, '3': { class_type: 'SaveVideo', inputs: { video: ['4', 0] } }, '4': { class_type: 'CreateVideo', inputs: { images: ['1', 0] } } }
    const draft = (state.models[0].meta as { comfyWorkflowImport: { text: string; binding: { outputNodeId: string } } }).comfyWorkflowImport
    draft.text = JSON.stringify(workflow)
    draft.binding.outputNodeId = '4'
    state.mappings[0].create!.body = { prompt: buildImportedWorkflow(workflow, draft.binding).templatedGraph, partial_execution_targets: ['4'] }
    const result = migrateComfyWorkflowOutputs(state)
    expect(result.mappings[0]).toMatchObject({ taskKind: 'image_to_video', create: { body: { partial_execution_targets: ['3'] } } })
    expect(result.models[0]).toMatchObject({ meta: { comfyWorkflowImport: { binding: { outputNodeId: '3', outputKind: 'video' } } } })
    expect(migrateComfyWorkflowOutputs(result)).toEqual(result)
  })

  it.each([
    { name: 'custom targets including the saver', targets: ['2', '3', '4'] },
    { name: 'omitted targets executing all outputs', targets: undefined },
    { name: 'null targets executing all outputs', targets: null },
  ])('migrates $name without rewriting the execution selection', ({ targets }) => {
    const state = legacyConstructorCatalog(targets)
    const result = migrateComfyWorkflowOutputs(structuredClone(state))
    expect(result.models[0]).toMatchObject({ kind: 'video', meta: { comfyWorkflowImport: { binding: { outputNodeId: '3', outputKind: 'video' } } } })
    expect(result.mappings[0]).toMatchObject({ taskKind: 'text_to_video', query: { response_mapping: { video_url: 'video_url' } } })
    expect(result.mappings[0].create).toEqual(state.mappings[0].create)
    expect(migrateComfyWorkflowOutputs(result)).toEqual(result)
  })

  it.each([
    { name: 'custom constructor and preview only', targets: ['2', '4'] },
    { name: 'custom preview only', targets: ['4'] },
    { name: 'empty selection', targets: [] },
    { name: 'string instead of a list', targets: '3' },
    { name: 'number instead of a list', targets: 3 },
    { name: 'object instead of a list', targets: { '3': true } },
    { name: 'numeric node ids', targets: [3] },
    { name: 'mixed invalid list', targets: ['3', 4] },
  ])('leaves the entire model and mappings untouched for $name', ({ targets }) => {
    const state = legacyConstructorCatalog(targets)
    const before = structuredClone(state)
    const result = migrateComfyWorkflowOutputs(state)
    expect(result).toEqual(before)
    expect(state).toEqual(before)
    expect(migrateComfyWorkflowOutputs(result)).toEqual(before)
  })

  it('a disabled repairable mapping cannot authorize migration of an unsafe enabled mapping', () => {
    const state = legacyConstructorCatalog(['2', '4'])
    const disabled = structuredClone(state.mappings[0])
    disabled.enabled = false
    disabled.create!.body = { ...(disabled.create!.body as Record<string, unknown>), partial_execution_targets: ['2'] }
    state.mappings.push(disabled)
    expect(migrateComfyWorkflowOutputs(structuredClone(state))).toEqual(state)
  })

  it('an existing enabled video mapping cannot authorize migration when its saver is not executed', () => {
    const state = legacyConstructorCatalog(['2', '4'])
    const target = structuredClone(state.mappings[0])
    target.taskKind = 'text_to_video'
    target.query!.response_mapping = { video_url: 'video_url' }
    state.mappings.push(target)
    expect(migrateComfyWorkflowOutputs(structuredClone(state))).toEqual(state)
  })

  it('does not change an unsafe enabled custom selection even when another enabled mapping executes the saver', () => {
    const state = legacyConstructorCatalog(['2', '4'])
    const target = structuredClone(state.mappings[0])
    target.taskKind = 'text_to_video'
    target.create!.body = { ...(target.create!.body as Record<string, unknown>), partial_execution_targets: ['3'] }
    target.query!.response_mapping = { video_url: 'video_url' }
    state.mappings.push(target)
    expect(migrateComfyWorkflowOutputs(structuredClone(state))).toEqual(state)
  })

  it('does not treat a node with the same id in another task graph as proof that the saver executes', () => {
    const state = legacyConstructorCatalog(['2'])
    const target = structuredClone(state.mappings[0])
    target.taskKind = 'text_to_video'
    target.create!.body = { prompt: { '3': { class_type: 'PreviewImage', inputs: {} } }, partial_execution_targets: ['3'] }
    target.query!.response_mapping = { video_url: 'video_url' }
    state.mappings.push(target)
    expect(migrateComfyWorkflowOutputs(structuredClone(state))).toEqual(state)
  })

  it('does not infer a migration for a custom output even with an explicit declaration', () => {
    const state = legacyCatalog()
    state.models[0].meta = { comfyWorkflowImport: { text: JSON.stringify({ '3': { class_type: 'CustomWriter', inputs: {} } }), binding: { outputNodeId: '3', outputKind: 'video' } } }
    expect(migrateComfyWorkflowOutputs(state)).toEqual(state)
  })

  it('corrects model, binding and mapping on read and persists without rebuilding user parameters', async () => {
    const before = legacyCatalog()
    const file = path.join(root, 'model-catalog.json')
    fs.writeFileSync(file, JSON.stringify(before))
    const { readCatalog } = await import('./catalogStore')
    const after = readCatalog()
    expect(after.version).toBe(CURRENT_CATALOG_VERSION)
    expect(after.models[0]).toMatchObject({ modelKey: 'comfy-existing', kind: 'video', enabled: false, meta: { userSetting: 'keep', comfyWorkflowImport: { binding: { outputNodeId: '3', outputKind: 'video' } } } })
    expect(after.models[0].meta).toMatchObject({ parameters: (before.models[0].meta as Record<string, unknown>).parameters })
    expect(after.mappings[0]).toMatchObject({ taskKind: 'image_to_video', query: { response_mapping: { video_url: 'video_url', error_message: 'error', custom: 'keep' } } })
    expect(after.mappings[0].query?.response_mapping).not.toHaveProperty('image_url')
    expect(after.mappings[0].create).toEqual(before.mappings[0].create)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).models[0].kind).toBe('video')
    const once = fs.readFileSync(file, 'utf8')
    expect(readCatalog()).toEqual(after)
    expect(fs.readFileSync(file, 'utf8')).toBe(once)
  })

  it('does not touch another vendor, another instance, a corrupt draft or a manual preview selection', async () => {
    const state = legacyCatalog()
    const original = state.models[0]
    state.models.push(
      { ...original, vendorKey: 'other-provider' },
      { ...original, vendorKey: 'comfyui-local-secondary', meta: { comfyWorkflowImport: { text: '{broken', binding: {} } } },
      { ...original, modelKey: 'preview', meta: { comfyWorkflowImport: { text: JSON.stringify({ ...graph, '4': { class_type: 'PreviewImage', inputs: { images: ['1', 0] } } }), binding: { outputNodeId: '4', outputKind: 'image' } } } },
    )
    state.mappings.push({ ...state.mappings[0], vendorKey: 'comfyui-local-secondary' })
    fs.writeFileSync(path.join(root, 'model-catalog.json'), JSON.stringify(state))
    const { readCatalog } = await import('./catalogStore')
    const result = readCatalog()
    expect(result.models[0].kind).toBe('video')
    expect(result.models.slice(1)).toEqual(state.models.slice(1))
    expect(result.mappings[1]).toEqual(state.mappings[1])
  })
})
