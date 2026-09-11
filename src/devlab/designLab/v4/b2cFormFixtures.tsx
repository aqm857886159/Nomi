import React from 'react'
import type { GenerationModelDefaultMap } from '../../../workbench/generationCanvas/model/generationModelDefaults'
import { useTranslation } from 'react-i18next'
import { AgentPanelV4Panel } from '../../../workbench/ai/v4/AgentPanelV4Panel'
import { V4ModelPopover } from '../../../workbench/ai/v4/AgentPanelV4Composer'
import { buildV4ModelRows } from '../../../workbench/ai/v4/agentPanelV4ModelRows'
import { collapseV4Flow } from '../../../workbench/ai/v4/agentPanelV4Collapse'
import type { V4FlowItem, V4ToolStatus } from '../../../workbench/ai/v4/agentPanelV4Types'
import type { ModelCatalogModelDto } from '../../../workbench/api/modelCatalogApi'

// Same catalog DTOs and three kind-specific calls as useAgentPanelV4Data.reloadModels.
const B2C_MODELS: ModelCatalogModelDto[] = [
  { modelKey: 'deepseek-v4-pro', labelZh: 'DeepSeek V4 Pro', kind: 'text' },
  { modelKey: 'gpt-image-2', labelZh: 'GPT Image 2', kind: 'image' },
  { modelKey: 'MiniMax-H3', labelZh: 'MiniMax H3', kind: 'video' },
].map(model => ({ ...model, kind: model.kind as ModelCatalogModelDto['kind'], vendorKey: 'b2c-catalog', enabled: true, published: true, publishedModes: [], availability: { usable: true } as const, createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z' }))

export function B2cModelSpecimen(): JSX.Element {
  const { t } = useTranslation()
  const [selectedModel, selectModel] = React.useState(B2C_MODELS[0])
  const [generationDefaults, setDefaults] = React.useState<GenerationModelDefaultMap>({ text_to_image: { vendorKey: 'b2c-catalog', modelKey: 'gpt-image-2' }, text_to_video: { vendorKey: 'b2c-catalog', modelKey: 'MiniMax-H3' } })
  const rows = buildV4ModelRows({
    models: B2C_MODELS.filter(model => model.kind === 'text'), generationModels: B2C_MODELS.filter(model => model.kind !== 'text'),
    vendors: { 'b2c-catalog': 'Catalog' }, orderedVendorKeys: ['b2c-catalog'], selectedModel,
    modelLabel: selectedModel?.labelZh ?? '', selectModel, generationDefaults,
    setGenerationDefault: (kind, identity) => setDefaults(current => ({ ...current, [kind]: identity ?? undefined })),
  }, t)
  return <V4ModelPopover rows={rows} />
}

export function B2cProcessSpecimen({ state }: { state: V4ToolStatus }): JSX.Element {
  const { t } = useTranslation()
  const turn = { turnId: 'b2c-turn', createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:12Z' }
  const tool = (label: string, status: V4ToolStatus): V4FlowItem => ({ kind: 'tool', receipt: { label, action: 'document', status, turnId: turn.turnId, summary: status === 'output-error' ? '写入失败，请重试' : undefined } })
  const flow: V4FlowItem[] = [
    { kind: 'user', text: '把这篇文稿拆成 8 个分镜。' },
    ...(state === 'output-available' ? [{ kind: 'assistant', text: '已写入 8 个分镜。\n\n下一步：补齐角色参考图，再开始生成。', status: 'complete' } as V4FlowItem] : []),
    tool('读取全文', 'output-available'),
    { kind: 'thinking', label: '思考', meta: '检查分镜结构' },
    tool('加载分镜技能', 'output-available'),
    tool('写入 8 镜', state === 'input-available' ? 'input-available' : state === 'output-error' ? 'output-error' : 'output-available'),
  ]
  return <div style={{ width: 390, height: 620 }}><AgentPanelV4Panel width={390} height={620} context={{}}
    flow={collapseV4Flow(flow, t, { turns: [turn], elapsedSeconds: 8, liveTurnId: state === 'input-available' ? turn.turnId : undefined })}
    composer={{ mode: state === 'input-available' ? 'running' : 'idle', modelLabel: 'DeepSeek V4 Pro' }} /></div>
}
