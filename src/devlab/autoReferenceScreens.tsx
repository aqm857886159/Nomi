// 自动引用样张（2026-10-08 用户拍板的交互）：
//   · AI 写的方案（Agent / 分镜方案）里的指代直接绑定成正式 chip；对不上（不存在 / 同名两个）退回建议态；
//   · 用户在画布里自己写的提示词不直接绑：识别到的词下面一条灰虚线 = 建议，悬停 / 点击出候选，选了才绑；
//     继续打字 = 忽略；用户手动去掉的引用永不自动加回；
//   · @ 菜单两类来源：Agent（方案里的视觉锚）/ 画布节点（进点选模式，直接去画布上点）；
//   · 付费确认卡逐镜列出本次实际引用。
// 三处（画布节点、列表卡 / 检查器、Agent 付费卡）用的是同一个生成框（NodeGenerationComposer）、
// 同一颗 chip（AssetMentionChip）、同一层建议线与同一个候选列表（referencePromptKit）。
import React, { type JSX } from 'react'
import BaseGenerationNode from '../workbench/generationCanvas/nodes/BaseGenerationNode'
import type { GenerationCanvasNode } from '../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../workbench/generationCanvas/store/generationCanvasStore'
import { LabCanvasViewport } from './designLab/labCanvasViewport'
import { shotArt } from './listViewArt'
import { AgentSpendStage } from './autoReferenceAgent'
import { cardNode, IMAGE_META, referenceEdges, refNode, useLabLanguage, useSeededCanvas } from './listViewStage'
import { watchCandidates } from './autoReferenceData'
import {
  ChipRemoveLayer,
  mentionSourceGroups,
  PickModeBar,
  ReferencePickList,
  SuggestionLayer,
  useOutsideClose,
  usePickListKeys,
  type PickRow,
} from './referencePromptKit'
import { AnchorStrip, AppChrome, InspectorPanel, ListCardView, SectionHeader } from './storyboardListViewParts'
import {
  ANCHOR_IDS,
  createListSections,
  expandPrompt,
  REFS,
  refName,
  tokenRefs,
  type ListCard,
  type ListViewLocale,
  type RefId,
} from './storyboardListViewData'
import { AnchoredPopover } from '../design'

export type AutoRefState =
  | 'node-suggest'
  | 'node-candidates'
  | 'node-bound'
  | 'node-removed'
  | 'node-mention'
  | 'pick-mode'
  | 'pick-done'
  | 'list'
  | 'agent'

const COMPOSER_PROMPT = '[data-node-composer-prompt] .ProseMirror'

/** 用户自己在画布写的那句：「林薇」已是正式引用，「怀表」是识别到的建议。 */
const USER_PROMPT: Record<ListViewLocale, string> = {
  zh: '近景，{lin}侧脸，雨水顺着发梢滑下，她低头看着手里的{watch}',
  en: 'Close-up, {lin} in profile, rain runs from her hair as she looks down at the {watch} in her hand',
}
const PICK_TAIL: Record<ListViewLocale, string> = { zh: '，身后是', en: ', behind her ' }

/**
 * 画布坐标（画布缩放 0.8，和真画布一样：节点跟着缩，生成浮框反向缩放保持 1:1 可读）。
 * 左右两列是能被引用的素材节点；下方两张不能引用（等定妆 / 还没出图）。
 */
const CANVAS_ZOOM = 0.8
const LAYOUT: Array<{ id: RefId; x: number; y: number }> = [
  { id: 'lin', x: 60, y: 60 },
  { id: 'watch', x: 60, y: 400 },
  { id: 'oldWatch', x: 60, y: 740 },
  { id: 'store', x: 1500, y: 60 },
  { id: 'storeDay', x: 1500, y: 400 },
  { id: 'chain', x: 1500, y: 740 },
]
const TARGET = { x: 560, y: 150 }
const BLOCKED: Array<{ node: (locale: ListViewLocale) => GenerationCanvasNode; x: number; y: number }> = [
  { node: (locale) => refNode('look', locale), x: 1110, y: 790 },
  {
    node: (locale) => ({
      ...cardNode(createListSections('default')[0].cards[3], locale, ''),
      id: 'shot-4-idle',
      status: 'idle',
      result: undefined,
    }),
    x: 640,
    y: 830,
  },
]

/** 正在写提示词的那张镜头节点（已出过一版图）。 */
function targetNode(locale: ListViewLocale, prompt: string): GenerationCanvasNode {
  const card: ListCard = createListSections('default')[0].cards[1]
  return {
    ...cardNode({ ...card, media: 'image', ratio: '16:9', status: 'ready', art: shotArt(2, '16:9', '#704b45|#201312') }, locale, prompt),
    meta: IMAGE_META('16:9'),
  }
}

/** 打 @ 的那个位置（提示词末尾那个「@」字）——菜单贴着它出。 */
function useCaretRect(rootRef: React.RefObject<HTMLElement | null>, active: boolean): (() => DOMRect) | null {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    if (!active) return undefined
    let frame = 0
    const wait = () => {
      if (rootRef.current?.querySelector(COMPOSER_PROMPT)) setReady(true)
      else frame = requestAnimationFrame(wait)
    }
    wait()
    return () => cancelAnimationFrame(frame)
  }, [rootRef, active])
  if (!active || !ready) return null
  return () => {
    const editor = rootRef.current?.querySelector(COMPOSER_PROMPT)
    const walker = editor ? document.createTreeWalker(editor, NodeFilter.SHOW_TEXT) : null
    let last: Range | null = null
    for (let node = walker?.nextNode(); node; node = walker?.nextNode()) {
      const at = (node.textContent ?? '').lastIndexOf('@')
      if (at >= 0) {
        last = document.createRange()
        last.setStart(node, at)
        last.setEnd(node, at + 1)
      }
    }
    return last?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0)
  }
}

function CanvasStage({ locale, state }: { locale: ListViewLocale; state: AutoRefState }): JSX.Element {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [watch, setWatch] = React.useState<'suggest' | 'bound' | 'rejected'>(
    state === 'node-bound' ? 'bound' : state === 'node-removed' ? 'rejected' : 'suggest',
  )
  const [openKey, setOpenKey] = React.useState<string | null>(state === 'node-candidates' ? 'watch' : null)
  const [mentionOpen, setMentionOpen] = React.useState(state === 'node-mention')
  const [picking, setPicking] = React.useState(state === 'pick-mode')
  const [picked, setPicked] = React.useState<RefId | null>(state === 'pick-done' ? 'store' : null)
  const pickTail = state === 'node-mention' || state === 'pick-mode' || state === 'pick-done' || mentionOpen || picking || picked
  const bound: RefId[] = ['lin', ...(watch === 'bound' ? (['watch'] as RefId[]) : []), ...(picked ? [picked] : [])]
  const prompt =
    expandPrompt(USER_PROMPT[locale], locale, bound) +
    (pickTail ? `${PICK_TAIL[locale]}${picked ? expandPrompt(`{${picked}}`, locale).replace(refName(picked, locale), '') : ' @'}` : '')
  const target = React.useMemo(() => targetNode(locale, prompt), [locale, prompt])
  const nodes = React.useMemo(
    () => [
      ...LAYOUT.map((entry) => refNode(entry.id, locale)),
      ...BLOCKED.map((entry) => entry.node(locale)),
      target,
    ],
    [locale, target],
  )
  const edges = React.useMemo(() => referenceEdges(target.id, bound), [target.id, bound.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const ready = useSeededCanvas(nodes, edges, picking ? [] : [target.id])
  const live = useGenerationCanvasStore((store) => store.nodes)
  const suggestions = watch === 'suggest' && !picking ? [watchCandidates(locale)] : []
  const caretRect = useCaretRect(rootRef, mentionOpen && ready)
  const mentionGroups = React.useMemo(
    () => mentionSourceGroups(locale, ANCHOR_IDS.map((id) => ({ key: id, label: refName(id, locale), art: REFS[id].art, ready: REFS[id].ready }))),
    [locale],
  )
  const onMentionPick = React.useCallback((row: PickRow) => {
    setMentionOpen(false)
    if (row.key === 'pick-on-canvas') setPicking(true)
    else setPicked(row.key as RefId)
  }, [])
  const closeMention = React.useCallback(() => setMentionOpen(false), [])
  const [mentionActive, setMentionActive] = usePickListKeys(mentionOpen, mentionGroups, onMentionPick, closeMention, 'pick-on-canvas')
  useOutsideClose(mentionOpen, closeMention)
  React.useEffect(() => {
    if (!picking) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicking(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking])
  const pickable = (id: string) => LAYOUT.some((entry) => REFS[entry.id].nodeId === id)
  const hovered = state === 'pick-mode' ? REFS.store.nodeId : null
  return (
    <div
      ref={rootRef}
      data-lab-ready={ready ? 'true' : undefined}
      className="workbench-generation__canvas relative overflow-hidden bg-[var(--workbench-surface)]"
      style={{ height: 'calc(100vh - 53px)' }}
    >
      <LabCanvasViewport zoom={CANVAS_ZOOM}>
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: `${100 / CANVAS_ZOOM}%`, height: `${100 / CANVAS_ZOOM}%`, transform: `scale(${CANVAS_ZOOM})` }}
        >
        {ready
          ? live.map((node) => {
              const isTarget = node.id === target.id
              const layout = LAYOUT.find((entry) => REFS[entry.id].nodeId === node.id)
              const blocked = BLOCKED.find((entry) => entry.node(locale).id === node.id)
              const position = isTarget ? TARGET : layout ?? blocked ?? { x: 0, y: 0 }
              const canPick = picking && pickable(node.id)
              return (
                <div
                  key={node.id}
                  className={[
                    'absolute rounded-nomi',
                    picking && canPick ? 'z-20' : '',
                    canPick ? 'cursor-pointer [&>article]:rounded-nomi [&>article]:ring-offset-2 [&>article]:ring-offset-[var(--workbench-surface)]' : '',
                    canPick && hovered === node.id
                      ? '[&>article]:ring-[3px] [&>article]:ring-nomi-accent'
                      : canPick
                        ? '[&>article]:ring-2 [&>article]:ring-nomi-accent/60'
                        : '',
                    picking && !canPick ? 'opacity-40 grayscale' : '',
                  ].join(' ')}
                  style={{ left: position.x, top: position.y }}
                  onClickCapture={(event) => {
                    if (!canPick) return
                    event.stopPropagation()
                    const ref = LAYOUT.find((entry) => REFS[entry.id].nodeId === node.id)
                    setPicking(false)
                    if (ref) setPicked(ref.id)
                  }}
                >
                  <BaseGenerationNode node={node} selected={isTarget && !picking} />
                </div>
              )
            })
          : null}
        {picking ? <div className="absolute inset-0 z-10 bg-nomi-ink/30" aria-hidden /> : null}
        </div>
        {picking ? (
          <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2">
            <PickModeBar locale={locale} onExit={() => setPicking(false)} />
          </div>
        ) : null}
      </LabCanvasViewport>
      {ready && !picking ? (
        <>
          <SuggestionLayer
            rootRef={rootRef}
            editorSelector={COMPOSER_PROMPT}
            suggestions={suggestions}
            openKey={openKey}
            onOpenChange={setOpenKey}
            onPick={() => {
              setOpenKey(null)
              setWatch('bound')
            }}
          />
          <ChipRemoveLayer
            rootRef={rootRef}
            editorSelector={COMPOSER_PROMPT}
            locale={locale}
            forceUrl={state === 'node-bound' && watch === 'bound' ? REFS.watch.art : null}
            onRemove={(url) => {
              if (url === REFS.watch.art) setWatch('rejected')
              if (picked && url === REFS[picked].art) setPicked(null)
            }}
          />
        </>
      ) : null}
      {caretRect ? (
        <AnchoredPopover anchorRect={caretRect} gap={6}>
          <ReferencePickList groups={mentionGroups} activeKey={mentionActive} onActive={setMentionActive} onPick={onMentionPick} />
        </AnchoredPopover>
      ) : null}
    </div>
  )
}

// ── 列表：卡上一行提示词 + 检查器生成框，挂同一层建议线与候选 ───────────────────────

/** 列表里那一镜：卡上只露一行，所以把建议词放在句子前半截，卡和检查器都看得到同一条线。 */
const LIST_PROMPT: Record<ListViewLocale, string> = {
  zh: '特写，{lin}握紧手里的{watch}，雨水顺着发梢滑下',
  en: 'Insert, {lin} grips the {watch} as rain runs from her hair',
}

function ListStage({ locale }: { locale: ListViewLocale }): JSX.Element {
  const sections = React.useMemo(() => createListSections('default'), [])
  const storyboard = sections[0]
  const [watch, setWatch] = React.useState<'suggest' | 'bound' | 'rejected'>('suggest')
  const [openKey, setOpenKey] = React.useState<string | null>('watch')
  const cards = sections.flatMap((section) => section.cards).filter((card) => card.kind !== 'director')
  const overrideId = 'shot-2'
  const overridePrompt = expandPrompt(LIST_PROMPT[locale], locale, watch === 'bound' ? ['lin', 'watch'] : ['lin'])
  const nodes = React.useMemo(
    () => [
      ...(Object.keys(REFS) as RefId[]).map((id) => refNode(id, locale)),
      ...cards.map((card) => cardNode(card, locale, card.id === overrideId ? overridePrompt : undefined)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, overridePrompt, sections],
  )
  const edges = React.useMemo(
    () => cards.flatMap((card) => referenceEdges(card.id, card.id === overrideId ? (watch === 'bound' ? ['lin', 'watch'] : ['lin']) : card.refs)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, watch],
  )
  const ready = useSeededCanvas(nodes, edges)
  const suggestions = watch === 'suggest' ? [watchCandidates(locale)] : []
  const inspectorCard = storyboard.cards[1]
  if (!ready) return <div />
  return (
    <div className="mx-auto max-w-[1440px] p-4" data-lab-ready="true">
      <div className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm">
        <AnchorStrip locale={locale} />
        <div className="grid min-w-0" style={{ gridTemplateColumns: inspectorCard ? 'minmax(0, 1fr) minmax(440px, 480px)' : 'minmax(0, 1fr)' }}>
          <div className="min-w-0 p-4">
            {[storyboard].map((section) => (
              <section key={section.id} className="mb-5 last:mb-0">
                <SectionHeader section={section} locale={locale} onGenerate={() => undefined} />
                <div className={`grid gap-x-8 gap-y-4 pl-8 ${inspectorCard ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {section.cards.map((card, index) => (
                    <ListCardView
                      key={card.id}
                      card={card}
                      locale={locale}
                      index={index}
                      mediaHeight={220}
                      suggestions={card.id === overrideId ? suggestions : undefined}
                      onSelect={() => undefined}
                      onConnect={() => undefined}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          {inspectorCard ? (
            <InspectorPanel
              card={{ ...inspectorCard, refs: tokenRefs(LIST_PROMPT[locale]) }}
              locale={locale}
              onClose={() => undefined}
              promptOverlay={(rootRef) => (
                <SuggestionLayer
                  rootRef={rootRef}
                  editorSelector={COMPOSER_PROMPT}
                  suggestions={suggestions}
                  openKey={openKey}
                  onOpenChange={setOpenKey}
                  onPick={() => {
                    setOpenKey(null)
                    setWatch('bound')
                  }}
                />
              )}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function AutoReferenceApp(): JSX.Element {
  const params = new URL(window.location.href).searchParams
  const state = (params.get('state') as AutoRefState | null) ?? 'node-suggest'
  const locale: ListViewLocale = params.get('locale') === 'en' ? 'en' : 'zh'
  const languageReady = useLabLanguage(locale)
  const canvas = state.startsWith('node-') || state.startsWith('pick-')
  return (
    <div className="min-h-screen bg-nomi-bg text-nomi-ink">
      {state === 'agent' ? null : (
        <AppChrome locale={locale} state="default" view={canvas ? 'canvas' : 'list'} hideLabHeader onLocale={() => undefined} onView={() => undefined} />
      )}
      {!languageReady ? null : canvas ? (
        <CanvasStage key={`${state}-${locale}`} locale={locale} state={state} />
      ) : state === 'agent' ? (
        <AgentSpendStage locale={locale} />
      ) : (
        <ListStage key={`${state}-${locale}`} locale={locale} />
      )}
    </div>
  )
}
