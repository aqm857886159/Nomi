import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import { parseCustomCapabilityContract } from '../../../../electron/shared/modelArchetypes'
import { createGenerationNode } from '../model/graphOps'
import { applyHumanModeChoice } from '../nodes/controls/archetypeMeta'
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

    // 人手选了首尾帧、参考列表里正好两张：按首尾帧发，列表顺序 = 首、尾。方式按输入现算（2026-11-12）后，
    // 偏好只在放得下全部输入时生效——原先这里在两张参考之上再叠旧的首 / 尾帧键（共 4 张），首尾帧放不下，会按参考发。
    const frameMeta = applyHumanModeChoice(selectedNode.meta, archetype!, 'frames')
    const frameRequest = buildCatalogTaskRequest({
      ...selectedNode,
      meta: { ...frameMeta, referenceImageUrls: ['asset://first.png', 'asset://last.png'] },
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

  it('keeps the disconnected provider until the user chooses its successor', async () => {
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
    const successor: ModelCatalogModelDto = {
      modelKey: 'future-video-v1',
      vendorKey: 'replacement-relay',
      labelZh: 'Future Video V1',
      kind: 'video',
      enabled: true,
      published: true,
      availability: { usable: true },
      publishedModes: ['image_to_video'],
      meta: { customCapabilityContract: contract },
      createdAt: '',
      updatedAt: '',
    }
    // 候选晋升（serviceCatalog.promote）只把前任那一行**停用**、不删：旧行还在，这是「供应商断开」，不是退役。
    const predecessor: ModelCatalogModelDto = {
      ...successor,
      vendorKey: 'disconnected-relay',
      enabled: false,
      published: false,
      availability: { usable: false, reason: 'model_disabled' },
      publishedModes: [],
    }
    const models = [successor, predecessor]

    await expect(resolveExecutableNodeFromCatalog(node, {
      listCatalogVendors: async () => vendors,
      // 按主进程 filterByParams 的语义作答：带了哪个条件就按哪个筛。
      listCatalogModels: async (params) => models.filter((row) =>
        (params.vendorKey === undefined || row.vendorKey === params.vendorKey)
        && (params.kind === undefined || row.kind === params.kind)
        && (params.enabled === undefined || row.enabled === params.enabled)),
    })).rejects.toThrow(/disconnected-relay/)
    expect(node.meta?.modelVendor).toBe('disconnected-relay')

  })
})
