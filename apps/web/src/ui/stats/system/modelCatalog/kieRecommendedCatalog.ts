import type { ModelCatalogImportPackageDto } from './deps'

export type KieRecommendedModelId =
  | 'nano-banana-2'
  | 'gpt-image-2-text-to-image'
  | 'gpt-image-2-image-to-image'
  | 'seedream/5-lite-text-to-image'
  | 'veo3_fast'
  | 'kie-runway'

export type KieRecommendedModel = {
  id: KieRecommendedModelId
  label: string
  kind: 'image' | 'video'
  description: string
  sourceUrl: string
}

type RequestProfile = NonNullable<ModelCatalogImportPackageDto['vendors'][number]['mappings']>[number]['requestProfile']

export const KIE_RECOMMENDED_MODELS: KieRecommendedModel[] = [
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    kind: 'image',
    description: '通用图片生成，支持参考图输入，适合作为默认图模型。',
    sourceUrl: 'https://docs.kie.ai/market/google/nanobanana2',
  },
  {
    id: 'gpt-image-2-text-to-image',
    label: 'GPT Image 2 文生图',
    kind: 'image',
    description: 'GPT Image 2 文生图，使用 KIE jobs createTask 接口生成图片。',
    sourceUrl: 'https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image',
  },
  {
    id: 'gpt-image-2-image-to-image',
    label: 'GPT Image 2 编辑',
    kind: 'image',
    description: '参考图改图和局部重绘，适合从画布已有图片继续创作。',
    sourceUrl: 'https://docs.kie.ai/market/gpt/gpt-image-2-image-to-image',
  },
  {
    id: 'seedream/5-lite-text-to-image',
    label: 'Seedream 5 Lite',
    kind: 'image',
    description: '轻量文生图，适合批量草图和低成本预览。',
    sourceUrl: 'https://docs.kie.ai/market/seedream/5-lite-text-to-image',
  },
  {
    id: 'veo3_fast',
    label: 'Veo 3.1 Fast',
    kind: 'video',
    description: '通用视频生成，支持文生视频和首帧/尾帧参考。',
    sourceUrl: 'https://docs.kie.ai/veo3-api/generate-veo-3-video',
  },
  {
    id: 'kie-runway',
    label: 'Runway Video',
    kind: 'video',
    description: 'KIE Runway 视频能力，适合快速文生视频或图生视频。',
    sourceUrl: 'https://docs.kie.ai/runway-api/generate-ai-video',
  },
]

export function isKieDocsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    const host = url.hostname.toLowerCase()
    return host === 'docs.kie.ai' || host === 'kie.ai' || host.endsWith('.kie.ai')
  } catch {
    return false
  }
}

function selectedSet(selectedIds: readonly string[]): Set<KieRecommendedModelId> {
  return new Set(
    selectedIds.flatMap((id): KieRecommendedModelId[] => {
      if (id === 'nano-banana-2') return ['nano-banana-2']
      if (id === 'gpt-image-2-text-to-image') return ['gpt-image-2-text-to-image']
      if (id === 'gpt-image-2-image-to-image') return ['gpt-image-2-image-to-image']
      if (id === 'seedream/5-lite-text-to-image') return ['seedream/5-lite-text-to-image']
      if (id === 'veo3_fast') return ['veo3_fast']
      if (id === 'kie-runway') return ['kie-runway']
      return []
    }),
  )
}

function statusMapping() {
  return {
    queued: ['queued', 'pending', 'submitted', 'waiting', '0'],
    running: ['running', 'processing', 'generating', '1'],
    succeeded: ['succeeded', 'success', 'completed', 'complete', 'done', '2'],
    failed: ['failed', 'failure', 'error', 'fail', '3', '-1'],
  }
}

function modelEquals(modelKey: KieRecommendedModelId) {
  return {
    equals: {
      left: 'model.model_key',
      value: modelKey,
    },
  }
}

function marketResultResponseMapping(assetType: 'image' | 'video') {
  return {
    task_id: 'data.taskId',
    status: 'data.state|data.status|data.successFlag',
    error_message: 'data.failMsg|data.errorMessage|msg|message',
    assets: {
      type: assetType,
      urls: [
        'data.resultUrls',
        'data.response.resultUrls',
        {
          from: 'data.resultJson',
          transform: 'jsonStringFieldArray',
          field: 'resultUrls',
        },
      ],
    },
  }
}

function marketQuery(assetType: 'image' | 'video') {
  return {
    default: {
      method: 'GET',
      path: '/api/v1/jobs/recordInfo',
      query: {
        taskId: '{{taskId}}',
      },
      response_mapping: marketResultResponseMapping(assetType),
    },
  }
}

function marketImageCreateCandidate(input: {
  modelKey: KieRecommendedModelId
  input: Record<string, unknown>
}) {
  return {
    when: modelEquals(input.modelKey),
    method: 'POST',
    path: '/api/v1/jobs/createTask',
    body: {
      model: input.modelKey,
      input: input.input,
    },
    response_mapping: {
      task_id: 'data.taskId|taskId',
      status: 'data.state|data.status|data.successFlag',
      error_message: 'data.failMsg|data.errorMessage|data.error|msg|message|error',
    },
    provider_meta_mapping: {
      query_id: 'data.taskId|taskId',
    },
  }
}

function textToImageProfile(selected: Set<KieRecommendedModelId>): RequestProfile {
  const candidates = [
    selected.has('gpt-image-2-text-to-image')
      ? marketImageCreateCandidate({
        modelKey: 'gpt-image-2-text-to-image',
        input: {
          prompt: '{{request.prompt}}',
          aspect_ratio: '{{request.params.aspect_ratio}}',
          resolution: '{{request.params.resolution}}',
        },
      })
      : null,
    selected.has('nano-banana-2')
      ? marketImageCreateCandidate({
        modelKey: 'nano-banana-2',
        input: {
          prompt: '{{request.prompt}}',
          image_input: { from: 'request.params.referenceImages' },
          aspect_ratio: '{{request.params.aspect_ratio}}',
          resolution: '{{request.params.resolution}}',
          output_format: '{{request.params.output_format}}',
        },
      })
      : null,
    selected.has('seedream/5-lite-text-to-image')
      ? marketImageCreateCandidate({
        modelKey: 'seedream/5-lite-text-to-image',
        input: {
          prompt: '{{request.prompt}}',
          aspect_ratio: '{{request.params.aspect_ratio}}',
          quality: '{{request.params.quality}}',
          nsfw_checker: '{{request.params.nsfw_checker}}',
        },
      })
      : null,
  ].filter((item): item is ReturnType<typeof marketImageCreateCandidate> => item !== null)

  return {
    enabled: true,
    version: 'v2',
    status_mapping: statusMapping(),
    create: { candidates },
    query: marketQuery('image'),
  }
}

function imageEditProfile(selected: Set<KieRecommendedModelId>): RequestProfile {
  const candidates = [
    selected.has('gpt-image-2-image-to-image')
      ? marketImageCreateCandidate({
        modelKey: 'gpt-image-2-image-to-image',
        input: {
          prompt: '{{request.prompt}}',
          image_urls: { from: 'request.params.referenceImages' },
          aspect_ratio: '{{request.params.aspect_ratio}}',
          resolution: '{{request.params.resolution}}',
        },
      })
      : null,
    selected.has('nano-banana-2')
      ? marketImageCreateCandidate({
        modelKey: 'nano-banana-2',
        input: {
          prompt: '{{request.prompt}}',
          image_input: { from: 'request.params.referenceImages' },
          aspect_ratio: '{{request.params.aspect_ratio}}',
          resolution: '{{request.params.resolution}}',
          output_format: '{{request.params.output_format}}',
        },
      })
      : null,
  ].filter((item): item is ReturnType<typeof marketImageCreateCandidate> => item !== null)

  return {
    enabled: true,
    version: 'v2',
    status_mapping: statusMapping(),
    create: { candidates },
    query: marketQuery('image'),
  }
}

function veoCreate(generationType: 'text-to-video' | 'image-to-video') {
  return {
    when: modelEquals('veo3_fast'),
    method: 'POST',
    path: '/api/v1/veo/generate',
    body: {
      prompt: '{{request.prompt}}',
      model: 'veo3_fast',
      generationType,
      aspect_ratio: '{{request.params.aspect_ratio}}',
      imageUrls: [
        '{{request.params.firstFrameUrl}}',
        '{{request.params.lastFrameUrl}}',
      ],
    },
    response_mapping: {
      task_id: 'data.taskId|taskId',
      status: 'data.successFlag|data.status|data.state',
    },
    provider_meta_mapping: {
      query_id: 'data.taskId|taskId',
    },
  }
}

function runwayCreate() {
  return {
    when: modelEquals('kie-runway'),
    method: 'POST',
    path: '/api/v1/runway/generate',
    body: {
      prompt: '{{request.prompt}}',
      duration: '{{request.params.durationSeconds}}',
      quality: '{{request.params.quality}}',
      aspectRatio: '{{request.params.aspectRatio}}',
      imageUrl: '{{request.params.firstFrameUrl}}',
      waterMark: '{{request.params.waterMark}}',
    },
    response_mapping: {
      task_id: 'data.taskId|taskId',
      status: 'data.status|data.state|data.successFlag',
    },
    provider_meta_mapping: {
      query_id: 'data.taskId|taskId',
    },
  }
}

function veoQuery() {
  return {
    method: 'GET',
    path: '/api/v1/veo/record-info',
    query: { taskId: '{{taskId}}' },
    response_mapping: {
      task_id: 'data.taskId|taskId',
      status: 'data.successFlag|data.status|data.state',
      error_message: 'data.failMsg|data.errorMessage|msg|message',
      assets: {
        type: 'video',
        urls: 'data.response.resultUrls|data.response.fullResultUrls|data.response.originUrls',
      },
    },
  }
}

function runwayQuery() {
  return {
    method: 'GET',
    path: '/api/v1/runway/record-detail',
    query: { taskId: '{{taskId}}' },
    response_mapping: {
      task_id: 'data.taskId|taskId',
      status: 'data.status|data.state|data.successFlag',
      error_message: 'data.failMsg|data.errorMessage|msg|message',
      video_url: 'data.videoInfo.videoUrl',
    },
  }
}

function videoProfile(selected: Set<KieRecommendedModelId>, generationType: 'text-to-video' | 'image-to-video'): RequestProfile {
  const candidates = [
    selected.has('veo3_fast') ? veoCreate(generationType) : null,
    selected.has('kie-runway') ? runwayCreate() : null,
  ].filter((item): item is ReturnType<typeof veoCreate> | ReturnType<typeof runwayCreate> => item !== null)
  const queryCandidates: Record<string, unknown>[] = []
  if (selected.has('veo3_fast')) queryCandidates.push({ when: modelEquals('veo3_fast'), ...veoQuery() })
  if (selected.has('kie-runway')) queryCandidates.push({ when: modelEquals('kie-runway'), ...runwayQuery() })

  return {
    enabled: true,
    version: 'v2',
    status_mapping: statusMapping(),
    create: { candidates },
    query: { candidates: queryCandidates },
  }
}

function modelMeta(model: KieRecommendedModel): Record<string, unknown> {
  if (model.kind === 'image') {
    return {
      sourceUrl: model.sourceUrl,
      useCases: [model.description],
      imageOptions: {
        defaultAspectRatio: '1:1',
        aspectRatioOptions: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        imageSizeOptions: [],
        resolutionOptions: ['1K', '2K', '4K'],
        supportsReferenceImages: model.id !== 'seedream/5-lite-text-to-image',
        supportsTextToImage: model.id !== 'gpt-image-2-image-to-image',
        supportsImageToImage: model.id !== 'seedream/5-lite-text-to-image',
      },
      parameterControls: [
        ...(model.id === 'gpt-image-2-image-to-image'
          ? [{ key: 'referenceImageUrl', label: '参考图', type: 'image-url' }]
          : []),
        { key: 'aspect_ratio', label: '比例', type: 'select', defaultValue: '1:1', options: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
        { key: 'resolution', label: '清晰度', type: 'select', defaultValue: '1K', options: ['1K', '2K', '4K'] },
        ...(model.id !== 'gpt-image-2-image-to-image'
          ? [{ key: 'output_format', label: '格式', type: 'select', defaultValue: 'png', options: ['png', 'jpg', 'webp'] }]
          : []),
      ],
    }
  }
  return {
    sourceUrl: model.sourceUrl,
    useCases: [model.description],
    videoOptions: {
      defaultDurationSeconds: 8,
      defaultSize: '16:9',
      defaultOrientation: 'landscape',
      durationOptions: [{ value: 5, label: '5s' }, { value: 8, label: '8s' }],
      sizeOptions: [
        { value: '16:9', label: '16:9', orientation: 'landscape', aspectRatio: '16:9' },
        { value: '9:16', label: '9:16', orientation: 'portrait', aspectRatio: '9:16' },
      ],
      resolutionOptions: [],
      orientationOptions: [
        { value: 'landscape', label: '横屏', aspectRatio: '16:9' },
        { value: 'portrait', label: '竖屏', aspectRatio: '9:16' },
      ],
    },
    parameterControls: model.id === 'veo3_fast'
      ? [
          { key: 'firstFrameUrl', label: '首帧', type: 'image-url' },
          { key: 'lastFrameUrl', label: '尾帧', type: 'image-url' },
          { key: 'aspect_ratio', label: '画幅', type: 'select', defaultValue: '16:9', options: ['16:9', '9:16'] },
        ]
      : model.id === 'kie-runway'
        ? [
            { key: 'firstFrameUrl', label: '首帧', type: 'image-url' },
            { key: 'aspectRatio', label: '画幅', type: 'select', defaultValue: '16:9', options: ['16:9', '9:16'] },
            { key: 'quality', label: '质量', type: 'select', defaultValue: '720p', options: ['720p', '1080p'] },
            { key: 'durationSeconds', label: '时长', type: 'select', defaultValue: 5, options: [{ value: 5, label: '5s' }, { value: 8, label: '8s' }] },
          ]
        : [
            { key: 'aspect_ratio', label: '画幅', type: 'select', defaultValue: '16:9', options: ['16:9', '9:16'] },
          ],
  }
}

export function buildKieRecommendedModelCatalogPackage(input: {
  apiKey: string
  docsUrl: string
  selectedIds: readonly string[]
}): ModelCatalogImportPackageDto {
  const selected = selectedSet(input.selectedIds)
  const models = KIE_RECOMMENDED_MODELS
    .filter((model) => selected.has(model.id))
    .map((model) => ({
      modelKey: model.id,
      modelAlias: model.id,
      labelZh: model.label,
      kind: model.kind,
      enabled: true,
      meta: modelMeta(model),
      pricing: { cost: model.kind === 'image' ? 1 : 10, enabled: true, specCosts: [] },
    }))

  const mappings: NonNullable<ModelCatalogImportPackageDto['vendors'][number]['mappings']> = []
  if (selected.has('gpt-image-2-text-to-image') || selected.has('nano-banana-2') || selected.has('seedream/5-lite-text-to-image')) {
    mappings.push({
      taskKind: 'text_to_image',
      name: 'KIE 图片生成',
      enabled: true,
      requestProfile: textToImageProfile(selected),
    })
  }
  if (selected.has('gpt-image-2-image-to-image') || selected.has('nano-banana-2')) {
    mappings.push({
      taskKind: 'image_edit',
      name: 'KIE 图片编辑',
      enabled: true,
      requestProfile: imageEditProfile(selected),
    })
  }
  if (selected.has('veo3_fast') || selected.has('kie-runway')) {
    mappings.push({
      taskKind: 'text_to_video',
      name: 'KIE 文生视频',
      enabled: true,
      requestProfile: videoProfile(selected, 'text-to-video'),
    })
    mappings.push({
      taskKind: 'image_to_video',
      name: 'KIE 图生视频',
      enabled: true,
      requestProfile: videoProfile(selected, 'image-to-video'),
    })
  }

  return {
    version: 'v2',
    exportedAt: new Date().toISOString(),
    vendors: [{
      vendor: {
        key: 'kie-ai',
        name: 'KIE AI',
        enabled: true,
        baseUrlHint: 'https://api.kie.ai',
        authType: 'bearer',
        meta: {
          integrationDraft: {
            source: 'docs-url',
            docsUrl: input.docsUrl.trim(),
            channelKind: 'aggregator_gateway',
            adapterContract: 'requestProfile.v2',
            requiresAiAdapterCompletion: false,
          },
        },
      },
      apiKey: {
        apiKey: input.apiKey.trim(),
        enabled: true,
      },
      models,
      mappings,
    }],
  }
}
