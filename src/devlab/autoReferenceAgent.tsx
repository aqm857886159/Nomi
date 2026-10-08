// 自动引用 · Agent 面板那一格：Agent 按分镜方案出的付费卡（现役 AgentPanelV4Panel + 介入槽里的
// NodeGenerationComposer host="panel"，和 v4 屏「付费卡在真面板里」同一条装配）。
// 方案里写得出唯一身份的指代 → 落盘时就是正式 chip；「怀表」在画布上对得到两个（同名 + 别名）→ 不绑，
// 退回建议态，和画布上用户自己写的那句挂的是同一层建议线、同一个候选列表。
import React, { type JSX } from 'react'
import { AgentPanelV4Panel, type V4FlowItem } from '../workbench/ai/v4/AgentPanelV4Panel'
import { projectSpendCard } from '../workbench/ai/v4/agentPanelSpendCard'
import type { PendingSpendConfirm } from '../desktop/productionRunBridgeTypes'
import NodeGenerationComposer from '../workbench/generationCanvas/nodes/NodeGenerationComposer'
import { useGenerationCanvasStore } from '../workbench/generationCanvas/store/generationCanvasStore'
import { useV4Fixtures, V4_LAB_SLOT_HANDLERS } from './designLab/v4/agentPanelV4LabKit'
import { cardNode, referenceEdges, refNode, useSeededCanvas } from './listViewStage'
import { SuggestionLayer, type Suggestion } from './referencePromptKit'
import { AnchorStrip, ListCardView, SectionHeader } from './storyboardListViewParts'
import { createListSections, expandPrompt, REFS, tokenRefs, type ListViewLocale, type RefId } from './storyboardListViewData'
import { watchCandidates } from './autoReferenceData'

const COMPOSER_PROMPT = '[data-node-composer-prompt] .ProseMirror'

/** Agent 按方案写的 4 镜。`{watch}` 这一处在方案里写的是「怀表」，画布上有两个对得上 → 不绑。 */
const AI_PROMPTS: Record<ListViewLocale, string[]> = {
  zh: [
    '近景，{lin}侧脸，{store}落在睫毛上，她低头看着手里的{watch}',
    '中景，{lin}推开{store}的玻璃门，门口风铃晃动',
    '特写，{chain}从指缝间垂下，雨声盖过远处对白',
    '远景，{lin}走进雨夜，{store}在身后渐暗',
  ],
  en: [
    'Close-up, {lin} in profile, {store} caught in her lashes as she looks down at the {watch} in her hand',
    'Medium shot, {lin} pushes open the glass door of {store}, the chime swaying',
    'Insert, {chain} hangs between her fingers while rain covers distant dialogue',
    'Wide shot, {lin} walks into the rainy night as {store} dims behind her',
  ],
}
const UNRESOLVED: RefId[] = ['watch']

const FLOW_COPY: Record<ListViewLocale, { user: string; assistant: string }> = {
  zh: {
    user: '把「分镜 · 雨夜便利店」前 4 镜生成出来',
    assistant: '按分镜方案准备好 4 镜。第 1 镜的「怀表」画布上对得到两个，没有自动绑，点一下选。',
  },
  en: {
    user: 'Generate the first 4 shots of "Storyboard · Rainy convenience store"',
    assistant: 'The 4 shots are ready from the plan. "watch" in shot 1 matches two items on the canvas, so it is not bound yet. Click it to choose.',
  },
}

export function AgentSpendStage({ locale }: { locale: ListViewLocale }): JSX.Element {
  const fx = useV4Fixtures()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [watchBound, setWatchBound] = React.useState(false)
  const [openKey, setOpenKey] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(0)
  // 方案先出 4 张关键帧（图片），确认画面再转视频——付费卡这一页是图片生成框。
  const storyboard = React.useMemo(() => {
    const section = createListSections('default')[0]
    return { ...section, cards: section.cards.map((card, index) => (index < 4 ? { ...card, media: 'image' as const } : card)) }
  }, [])
  const shots = storyboard.cards.slice(0, 4)
  const bound = (template: string): RefId[] => tokenRefs(template).filter((id) => watchBound || !UNRESOLVED.includes(id))
  const prompts = AI_PROMPTS[locale].map((template) => expandPrompt(template, locale, bound(template)))
  const nodes = React.useMemo(
    () => [
      ...(Object.keys(REFS) as RefId[]).map((id) => refNode(id, locale)),
      ...storyboard.cards.map((card, index) => cardNode(card, locale, index < 4 ? prompts[index] : undefined)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, prompts.join('|')],
  )
  const edges = React.useMemo(
    () => storyboard.cards.flatMap((card, index) => referenceEdges(card.id, index < 4 ? bound(AI_PROMPTS[locale][index]) : card.refs)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, watchBound],
  )
  const ready = useSeededCanvas(nodes, edges)
  const live = useGenerationCanvasStore((state) => state.nodes)
  const node = live.find((candidate) => candidate.id === shots[page]?.id)
  const suggestions: Suggestion[] = watchBound ? [] : [watchCandidates(locale)]
  if (!ready || !node) return <div />
  const pending: PendingSpendConfirm = {
    projectId: 'design-lab',
    runId: 'design-lab-run',
    operationId: 'design-lab-op',
    planVersion: 1,
    quoteId: 'design-lab-quote',
    candidateRevision: 1,
    currency: 'CNY',
    shots: shots.map((card, index) => ({
      shotId: `lab-shot-${index + 1}`,
      nodeId: card.id,
      index: index + 1,
      prompt: prompts[index],
      providerId: 'apimart',
      modelId: card.media === 'video' ? 'seedance-2' : 'gpt-image-2',
      kind: card.media,
      mode: card.media === 'video' ? 'text_to_video' : 'text_to_image',
      parameters: {},
      price: { known: false as const },
    })),
    knownSubtotal: 0,
    unknownShotCount: shots.length,
  }
  const data = projectSpendCard(pending, { page }, fx.t, { locale: fx.locale, agentPickedModelIds: ['seedance-2', 'gpt-image-2'] })
  const flow: V4FlowItem[] = [
    { kind: 'user', text: FLOW_COPY[locale].user },
    { kind: 'assistant', text: FLOW_COPY[locale].assistant, status: 'complete' },
  ]
  const pageSuggestions = page === 0 ? suggestions : []
  return (
    <div className="grid h-screen min-h-0" style={{ gridTemplateColumns: 'minmax(0, 1fr) 420px' }} data-lab-ready="true">
      <div className="min-w-0 overflow-hidden p-4">
        <div className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm">
          <AnchorStrip locale={locale} />
          <div className="p-4">
            <SectionHeader section={storyboard} locale={locale} />
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 pl-8">
              {storyboard.cards.slice(0, 4).map((card, index) => (
                <ListCardView
                  key={card.id}
                  card={card}
                  locale={locale}
                  index={index}
                  mediaHeight={200}
                  suggestions={index === 0 ? suggestions : undefined}
                  onSelect={() => setPage(index)}
                  onToggle={() => undefined}
                  onConnect={() => undefined}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div ref={rootRef} className="relative min-h-0 border-l border-nomi-line">
        {data ? (
          <AgentPanelV4Panel
            slotHandlers={{ ...V4_LAB_SLOT_HANDLERS, onPage: setPage }}
            flow={flow}
            slot={data}
            slotComposer={<NodeGenerationComposer node={node} visualSize={{ width: 340, height: 192 }} host="panel" onFeedback={() => undefined} />}
            context={{ ...fx.context, used: 36000 }}
            height={typeof window === 'undefined' ? 900 : window.innerHeight}
          />
        ) : null}
        <SuggestionLayer
          rootRef={rootRef}
          editorSelector={COMPOSER_PROMPT}
          suggestions={pageSuggestions}
          openKey={openKey}
          onOpenChange={setOpenKey}
          onPick={() => {
            setOpenKey(null)
            setWatchBound(true)
          }}
        />
      </div>
    </div>
  )
}
