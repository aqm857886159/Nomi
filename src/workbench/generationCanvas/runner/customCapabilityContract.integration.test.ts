import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import { parseCustomCapabilityContract } from '../../../config/modelArchetypes'
import { createGenerationNode } from '../model/graphOps'
import { applyArchetypeModeSwitch } from '../nodes/controls/archetypeMeta'
import { buildNodeModelChangePatch } from '../nodes/buildNodeModelChangePatch'
import { buildCatalogTaskRequest } from './catalogTaskActions'
import { resolveExecutableNodeFromCatalog, resolveTaskArchetype } from './catalogTaskResolve'
import type { ModelCatalogModelDto, ModelCatalogVendorDto } from '../../api/modelCatalogApi'

const contract = {
  version: 1,
  kind: 'video',
  defaultModeId: 'references',
  transportTaskKind: 'image_to_video',
  modes: [
    {
      id: 'references',
      intent: 'character',
      vendorTerm: 'Multi reference',
      hint: 'Ordered reference images',
      promptRequired: true,
      transportTaskKind: 'image_to_video',
      slots: [{
        kind: 'image_ref',
        label: 'Reference images',
        min: 1,
        max: 4,
        inputKey: 'reference_images',
        asArray: true,
        characterIndexed: true,
      }],
      params: [],
    },
    {
      id: 'frames',
      intent: 'firstlast',
      vendorTerm: 'First and last frame',
      hint: '',
      promptRequired: true,
      transportTaskKind: 'image_to_video',
      slots: [
        { kind: 'first_frame', label: 'First frame', min: 1, max: 1, inputKey: 'first_image' },
        { kind: 'last_frame', label: 'Last frame', min: 0, max: 1, inputKey: 'last_image' },
      ],
      params: [],
      fixedParams: { generation_mode: 'frames' },
      combineSlotsInto: { key: 'frame_images', flat: true },
    },
  ],
} as const

describe('custom capability contract catalog -> canvas -> request', () => {
  it('copies only the normalized contract and uses each selected mode to build the real request', () => {
    const option: ModelOption = {
      value: 'future-video-v1',
      modelKey: 'future-video-v1',
      label: 'Future Video V1',
      vendor: 'custom-relay',
      meta: {
        customCapabilityContract: contract,
        adapter: { internalEvidence: 'must not leak into canvas' },
      },
    }
    const node = createGenerationNode({ id: 'future-node', kind: 'video' })
    const selected = buildNodeModelChangePatch({
      node,
      nodes: [node],
      edges: [],
      modelOptions: [option],
      value: option.value,
      vendor: option.vendor,
    })

    expect(parseCustomCapabilityContract(selected.meta)).toEqual(contract)
    expect(selected.meta.adapter).toBeUndefined()
    const selectedNode = {
      ...node,
      prompt: 'Keep the subject consistent',
      meta: { ...selected.meta, referenceImageUrls: ['asset://one.png', 'asset://two.png'] },
    }
    const archetype = resolveTaskArchetype(selectedNode.meta)
    expect(archetype?.modes.map((mode) => mode.id)).toEqual(['references', 'frames'])

    const referenceRequest = buildCatalogTaskRequest(selectedNode).request
    expect(referenceRequest.kind).toBe('image_to_video')
    expect(referenceRequest.extras?.archetypeInput).toMatchObject({
      reference_images: ['asset://one.png', 'asset://two.png'],
    })

    const frameMeta = applyArchetypeModeSwitch(selectedNode.meta, archetype!, 'frames')
    const frameRequest = buildCatalogTaskRequest({
      ...selectedNode,
      meta: { ...frameMeta, firstFrameUrl: 'asset://first.png', lastFrameUrl: 'asset://last.png' },
    }).request
    expect(frameRequest.kind).toBe('image_to_video')
    expect(frameRequest.extras?.archetypeInput).toMatchObject({
      frame_images: ['asset://first.png', 'asset://last.png'],
      generation_mode: 'frames',
    })
    expect(frameRequest.extras?.archetypeInput).not.toHaveProperty('first_image')
    expect(frameRequest.extras?.archetypeInput).not.toHaveProperty('last_image')
  })

  it('removes a stale custom contract when the user selects a model without one', () => {
    const node = createGenerationNode({ id: 'replace-node', kind: 'video' })
    node.meta = {
      modelKey: 'future-video-v1',
      modelVendor: 'custom-relay',
      customCapabilityContract: contract,
    }
    const ordinary: ModelOption = {
      value: 'ordinary-unknown-video',
      modelKey: 'ordinary-unknown-video',
      label: 'Ordinary video',
      vendor: 'custom-relay',
    }

    const selected = buildNodeModelChangePatch({
      node,
      nodes: [node],
      edges: [],
      modelOptions: [ordinary],
      value: ordinary.value,
      vendor: ordinary.vendor,
    })

    expect(selected.meta.customCapabilityContract).toBeUndefined()
    expect(resolveTaskArchetype(selected.meta)).toBeNull()
  })

  it('restores the target catalog contract when a disconnected provider is replaced at runtime', async () => {
    const node = createGenerationNode({ id: 'migrate-node', kind: 'video' })
    node.meta = {
      modelKey: 'future-video-v1',
      modelVendor: 'disconnected-relay',
      vendor: 'disconnected-relay',
    }
    const vendors: ModelCatalogVendorDto[] = [
      {
        key: 'disconnected-relay',
        name: 'Disconnected',
        enabled: true,
        hasApiKey: false,
        authType: 'bearer',
        createdAt: '',
        updatedAt: '',
      },
      {
        key: 'replacement-relay',
        name: 'Replacement',
        enabled: true,
        hasApiKey: true,
        authType: 'bearer',
        meta: {
          adapterCandidateRootVendorKey: 'disconnected-relay',
          adapterCandidateSourceVendorKey: 'disconnected-relay',
          adapterCandidatePromotionPredecessors: {
            'future-video-v1': { vendorKey: 'disconnected-relay', publishedModes: ['image_to_video'] },
          },
        },
        createdAt: '',
        updatedAt: '',
      },
    ]
    const models: ModelCatalogModelDto[] = [{
      modelKey: 'future-video-v1',
      vendorKey: 'replacement-relay',
      labelZh: 'Future Video V1',
      kind: 'video',
      enabled: true,
      published: true,
      publishedModes: ['image_to_video'],
      meta: { customCapabilityContract: contract },
      createdAt: '',
      updatedAt: '',
    }]

    const migrated = await resolveExecutableNodeFromCatalog(node, {
      listCatalogVendors: async () => vendors,
      listCatalogModels: async () => models,
    })

    expect(migrated.meta?.modelVendor).toBe('replacement-relay')
    expect(parseCustomCapabilityContract(migrated.meta)).toEqual(contract)
    expect(resolveTaskArchetype(migrated.meta ?? {})?.modes.map((mode) => mode.id)).toEqual([
      'references',
      'frames',
    ])
  })
})
