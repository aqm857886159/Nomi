import { MODEL_ANCHOR_GUIDANCE } from '../shared/agentCapabilities/availableModels'
import type { AgentModelEntry } from '../shared/agentCapabilities/availableModels'
import { modelCatalogReadSpec } from '../shared/agentCapabilities/modelFacingToolRegistry'
import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts'

/** 完整模型目录住在哪个动词上：与 lane 装配的是同一个（`modelCatalogReadSpec`）。 */
const MODEL_CATALOG_READ_VERB = modelCatalogReadSpec().name

/** A discovery index, not a second model contract. Full modes/slots stay behind the catalog read verb. */
export function formatLaneModelIndex(context: LaneComposerContext): string {
  const selected = context.model;
  const entries = (context.availableModels ?? []).filter(entry => entry.kind === 'image' || entry.kind === 'video');
  const lines: string[] = [];
  let kind = '';
  for (const entry of entries.slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.modelId.localeCompare(b.modelId)
    || (a.vendor ?? '').localeCompare(b.vendor ?? ''))) {
    if (entry.kind !== kind) { kind = entry.kind; lines.push(`[${kind}]`); }
    const byResolution = new Map<string, string[]>();
    for (const mode of entry.modes) {
      const resolution = mode.params.find(param => param.key === 'resolution')?.options?.map(option => option.value).join(',') ?? '';
      const names = byResolution.get(resolution) ?? [];
      names.push(`${mode.modeId}${mode.modeId === entry.defaultModeId ? '*' : ''}`);
      byResolution.set(resolution, names);
    }
    const modes = [...byResolution].map(([resolution, names]) => `${names.join(',')}${resolution ? `[${resolution}]` : ''}`).join('/');
    lines.push(`${entry.modelId}: ${modes}`);
  }
  if (!lines.length && !selected) return '';
  return [
    '可用模型索引（modelId: modeId[resolution]；* 是默认模式，逗号并列模式共用同一档位；保留原大小写）：',
    ...(selected ? [`text ${selected.vendorKey}/${selected.modelKey}（当前对话）`] : []),
    ...lines,
    ...MODEL_ANCHOR_GUIDANCE,
    `这里只列图片/视频任务。完整类别、参数、参考槽与各模式约束：nomi_request_tools group=models 后 ${MODEL_CATALOG_READ_VERB}（可用 modelId 缩小）；使用未列参数或参考边前先查。不要猜档位或混用不同模式参数。`,
  ].join('\n');
}

function identity(entry: AgentModelEntry): string { return JSON.stringify([entry.vendor, entry.modelId, entry.kind]) }

/** Pure adjacent-snapshot projection: reopening or projecting a message twice cannot consume its delta. */
export function formatLaneModelDelta(context: LaneComposerContext, previous?: LaneComposerContext): string {
  if (!previous) return '';
  const before = new Map((previous.availableModels ?? []).map(entry => [identity(entry), JSON.stringify(entry)]));
  const after = new Map((context.availableModels ?? []).map(entry => [identity(entry), entry]));
  const changed = [...after].filter(([key, entry]) => before.get(key) !== JSON.stringify(entry)).map(([, entry]) => entry);
  const removed = (previous.availableModels ?? []).filter(entry => !after.has(identity(entry)));
  if (!changed.length && !removed.length) return '';
  return ['本回合模型目录变化（覆盖之前的同名条目；失效模型不可再用）：',
    ...(changed.length ? [formatLaneModelIndex({ ...context, availableModels: changed }),
      ...changed.filter(entry => entry.kind !== 'image' && entry.kind !== 'video').map(entry => `新增/更新 ${entry.kind} ${entry.modelId}`)] : []),
    ...removed.map(entry => `失效 ${entry.kind} ${entry.vendor ?? ''}/${entry.modelId}`),
  ].filter(Boolean).join('\n');
}
