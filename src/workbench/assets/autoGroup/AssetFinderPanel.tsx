/**
 * 「找素材」面板（侧栏「分类」tab 旁的新视图）。recognition-first：
 * 顶部成片/参考两区 → 成片按挂载卡确定性归命名合集(零模型)+未分组墙 / 参考纯墙 →
 * 搜索 + 星标(可点设置) + 最近置顶 → 点缩略图定位画布。
 *
 * 零模型：成片"看懂内容"靠连线挂的角色/场景卡(结构化事实)，不是猜。读提示词文本/参考图
 * 按氛围聚 的"文本大脑/图像模型"层留待以后接（未分组/参考墙是其落点）。
 * 设计 docs/plan/2026-06-28-canvas-auto-grouping-and-find.md。
 */
import React from 'react'
import { IconStar, IconStarFilled, IconMovie, IconPhotoStar, IconSparkles } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { NomiImage } from '../../../design/media'
import { DesignSearchInput, DesignEmptyState } from '../../../design'
import { toast } from '../../../ui/toast'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { toFindItems, stackVariants, groupFilmStacksByCards, type FindZone, type VariantStack } from './autoGroup'
import { runContentGrouping } from './autoGroupService'

const FOCUS_EVENT = 'nomi-focus-generation-node'

function matches(stack: VariantStack, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return stack.items.some((it) =>
    `${it.title} ${it.prompt || ''} ${it.mounted.map((m) => m.title).join(' ')}`.toLowerCase().includes(needle),
  )
}

function StackCell({
  stack,
  onOpen,
  onToggleStar,
}: {
  stack: VariantStack
  onOpen: (id: string) => void
  onToggleStar: (id: string) => void
}): JSX.Element {
  const { cover } = stack
  const count = stack.items.length
  const marked = Boolean(cover.mark)
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'group relative block w-full text-left rounded-nomi-sm overflow-hidden border border-nomi-line bg-nomi-ink-05 cursor-pointer',
        'transition-[box-shadow,border-color] duration-[var(--nomi-transition-fast)] hover:border-nomi-accent',
      )}
      title={cover.title}
      onClick={() => onOpen(cover.nodeId)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(cover.nodeId) } }}
    >
      <span className="block aspect-square">
        <NomiImage className="w-full h-full object-cover" thumbnailSrc={cover.thumbUrl} src={cover.thumbUrl} alt={cover.title} />
      </span>
      {count > 1 ? (
        <span className={cn('absolute top-1 right-1 px-1.5 py-px rounded-full text-micro leading-none bg-nomi-ink text-nomi-paper')}>×{count}</span>
      ) : null}
      <button
        type="button"
        aria-label={marked ? '取消标记' : '标为主镜'}
        title={marked ? '取消标记' : '标为主镜'}
        onClick={(e) => { e.stopPropagation(); onToggleStar(cover.nodeId) }}
        className={cn(
          'absolute top-1 left-1 w-[18px] h-[18px] grid place-items-center rounded-full border-0 cursor-pointer',
          marked
            ? 'bg-nomi-accent text-nomi-paper'
            : 'bg-nomi-paper/85 text-nomi-ink-40 opacity-0 group-hover:opacity-100 hover:text-nomi-ink',
        )}
      >
        {marked ? <IconStarFilled size={12} /> : <IconStar size={12} stroke={1.5} />}
      </button>
      <span className={cn('block px-1.5 pt-1 pb-1.5 text-micro text-nomi-ink-80 truncate')}>{cover.title}</span>
    </div>
  )
}

function SectionGrid({
  title,
  count,
  stacks,
  onOpen,
  onToggleStar,
}: {
  title?: string
  count?: number
  stacks: VariantStack[]
  onOpen: (id: string) => void
  onToggleStar: (id: string) => void
}): JSX.Element {
  return (
    <div className="mb-3">
      {title ? (
        <div className="flex items-center gap-1.5 px-1 pb-1.5 text-caption text-nomi-ink-60">
          <span className="font-semibold text-nomi-ink-80 truncate">{title}</span>
          {typeof count === 'number' ? <span className="text-nomi-ink-30">{count}</span> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {stacks.map((s) => (
          <StackCell key={s.rootId} stack={s} onOpen={onOpen} onToggleStar={onToggleStar} />
        ))}
      </div>
    </div>
  )
}

export default function AssetFinderPanel(): JSX.Element {
  const nodes = useGenerationCanvasStore((s) => s.nodes)
  const edges = useGenerationCanvasStore((s) => s.edges)
  const selectNode = useGenerationCanvasStore((s) => s.selectNode)
  const updateNode = useGenerationCanvasStore((s) => s.updateNode)
  const [zone, setZone] = React.useState<FindZone>('film')
  const [query, setQuery] = React.useState('')
  const [starOnly, setStarOnly] = React.useState(false)

  const items = React.useMemo(() => toFindItems(nodes, edges), [nodes, edges])
  const counts = React.useMemo(
    () => ({
      film: items.filter((i) => i.zone === 'film').length,
      reference: items.filter((i) => i.zone === 'reference').length,
    }),
    [items],
  )
  const filtered = React.useMemo(() => {
    const inZone = items.filter((i) => i.zone === zone && (!starOnly || i.mark))
    return stackVariants(inZone)
      .filter((s) => matches(s, query))
      .sort((a, b) => b.cover.createdAt - a.cover.createdAt) // 最近生成置顶
  }, [items, zone, starOnly, query])
  const filmGrouped = React.useMemo(
    () => (zone === 'film' ? groupFilmStacksByCards(filtered) : null),
    [zone, filtered],
  )

  const open = React.useCallback(
    (nodeId: string) => {
      selectNode(nodeId)
      window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { nodeId } }))
    },
    [selectNode],
  )
  const toggleStar = React.useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      const meta = (node.meta as Record<string, unknown> | undefined) || {}
      updateNode(nodeId, { meta: { ...meta, mark: meta.mark ? undefined : '主镜' } })
    },
    [nodes, updateNode],
  )

  // 没连卡但有提示词的镜头 → 可交给文本大脑读提示词归命名组（按需触发，结果写 meta 缓存，省额度）。
  const [grouping, setGrouping] = React.useState(false)
  const aiCandidates = React.useMemo(
    () => (filmGrouped?.ungrouped || []).map((s) => s.cover).filter((c) => Boolean(c.prompt && c.prompt.trim())),
    [filmGrouped],
  )
  const handleAiGroup = React.useCallback(async () => {
    if (aiCandidates.length < 2 || grouping) return
    setGrouping(true)
    try {
      const res = await runContentGrouping(aiCandidates.map((c) => ({ nodeId: c.nodeId, prompt: c.prompt, title: c.title })))
      let n = 0
      for (const g of res.groups) {
        for (const id of g.nodeIds) {
          const node = nodes.find((x) => x.id === id)
          if (!node) continue
          const meta = (node.meta as Record<string, unknown> | undefined) || {}
          updateNode(id, { meta: { ...meta, autoGroup: g.name } })
          n += 1
        }
      }
      toast(n ? `已归好 ${res.groups.length} 组（${n} 张）` : '没找到能确定归类的，已保持未分组', n ? 'success' : 'info')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'AI 分组失败', 'error')
    } finally {
      setGrouping(false)
    }
  }, [aiCandidates, grouping, nodes, updateNode])

  const tab = (value: FindZone, label: string, count: number, Icon: typeof IconMovie) => (
    <button
      type="button"
      onClick={() => setZone(value)}
      className={cn(
        'flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-micro rounded-nomi-sm',
        zone === value ? 'bg-nomi-paper text-nomi-ink shadow-nomi-sm' : 'text-nomi-ink-40 hover:text-nomi-ink-60',
      )}
    >
      <Icon size={14} stroke={1.5} />{label} <span className="text-nomi-ink-30">{count}</span>
    </button>
  )

  const zoneCount = zone === 'film' ? counts.film : counts.reference
  const isEmpty = filtered.length === 0

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2 pt-2 pb-1.5 flex flex-col gap-2">
        <div className="flex items-center gap-0.5 rounded-nomi-sm bg-nomi-bg p-0.5">
          {tab('film', '成片', counts.film, IconMovie)}
          {tab('reference', '参考', counts.reference, IconPhotoStar)}
        </div>
        <div className="flex items-center gap-1.5">
          <DesignSearchInput className="flex-1" placeholder="搜素材…" ariaLabel="搜索素材" value={query} onChange={setQuery} />
          <button
            type="button"
            aria-pressed={starOnly}
            title="只看标记过的"
            onClick={() => setStarOnly((v) => !v)}
            className={cn(
              'shrink-0 inline-flex items-center justify-center w-[30px] h-[30px] rounded-full border',
              starOnly ? 'bg-nomi-accent text-nomi-paper border-nomi-accent' : 'bg-nomi-paper text-nomi-ink-40 border-nomi-line hover:text-nomi-ink',
            )}
          >
            <IconStar size={14} stroke={1.5} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {zone === 'film' && aiCandidates.length >= 2 && !isEmpty ? (
          <button
            type="button"
            onClick={handleAiGroup}
            disabled={grouping}
            className={cn(
              'mb-2 w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-nomi-sm text-caption',
              'border border-nomi-line bg-nomi-paper text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-ink',
              'disabled:opacity-60 disabled:cursor-default',
            )}
            title="读没归好那些的提示词，用 AI 归成命名组"
          >
            <IconSparkles size={14} stroke={1.5} className="text-nomi-accent" />
            {grouping ? '正在用 AI 归类…' : `用 AI 整理未分组的 ${aiCandidates.length} 张`}
          </button>
        ) : null}
        {isEmpty ? (
          <DesignEmptyState
            density="inline"
            icon={
              zone === 'film'
                ? <IconMovie size={32} stroke={1.5} className="text-nomi-ink-30" />
                : <IconPhotoStar size={32} stroke={1.5} className="text-nomi-ink-30" />
            }
            title={zoneCount === 0 ? (zone === 'film' ? '还没有成片' : '还没有参考') : '没有匹配的素材'}
            description={
              query || starOnly
                ? '换个搜索或清掉星标筛选。'
                : zone === 'film'
                  ? '在生成区生成镜头后会自动出现在这里。'
                  : '导入图片或拖入参考后出现在这里。'
            }
          />
        ) : zone === 'film' && filmGrouped ? (
          <>
            {filmGrouped.groups.map((g) => (
              <SectionGrid key={g.key} title={g.name} count={g.stacks.length} stacks={g.stacks} onOpen={open} onToggleStar={toggleStar} />
            ))}
            {filmGrouped.ungrouped.length > 0 ? (
              <SectionGrid
                title={filmGrouped.groups.length > 0 ? '未分组' : undefined}
                count={filmGrouped.groups.length > 0 ? filmGrouped.ungrouped.length : undefined}
                stacks={filmGrouped.ungrouped}
                onOpen={open}
                onToggleStar={toggleStar}
              />
            ) : null}
          </>
        ) : (
          <SectionGrid stacks={filtered} onOpen={open} onToggleStar={toggleStar} />
        )}
      </div>
    </div>
  )
}
