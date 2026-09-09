/**
 * 「找参考」面板：按平台搜正在跑的素材，挑一条落进项目素材库。
 *
 * 设计（已拍板 2026-09-07）：docs/design/2026-09-07-find-reference-design.md
 * 画布：https://claude.ai/code/artifact/309a8fc2-4599-4f63-8e5b-379e97768ccf
 *
 * 三条来自设计的硬约束，别在维护时改掉：
 *  ① **平台是项目级设定，不是每次搜索的筛选器**（跟分镜画幅同构）——做抖音的人不该每搜一次重选一次。
 *  ② **证据格按平台 derive**：本组件**不认识任何平台**，只按 evidence[] 的顺序渲染前两项 +
 *     `kind==='hot'` 的小标。哪些指标、什么顺序由主进程归一层决定（小红书收藏排点赞前面）。
 *  ③ **转译必须回显且可改**：不回显，用户不知道结果为什么长这样（卡点③b）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPhoto, IconTrendingUp, IconExternalLink, IconPlus } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignSearchInput } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../../ui/toast'
import { tikhubErrorKindOf } from '../../../electron/shared/contracts/tikhubErrorKinds'
import {
  REFERENCE_PLATFORMS,
  type ReferenceEvidence,
  type ReferenceItem,
  type ReferencePlatform,
  type ReferenceSearchResult,
} from '../../../electron/shared/contracts/referenceSearch'

/** connector 错误 kind → i18n 键。与贴链接那条共用同一套文案，不另写一份（P1）。 */
const ERROR_KEY: Record<string, string> = {
  'missing-key': 'assetLibrary.pasteLink.errMissingKey',
  auth: 'assetLibrary.pasteLink.errAuth',
  quota: 'assetLibrary.pasteLink.errQuota',
  'rate-limited': 'assetLibrary.findReference.errRateLimited',
  'not-found': 'assetLibrary.pasteLink.errNotFound',
  'no-play-url': 'assetLibrary.pasteLink.errNoPlayUrl',
  upstream: 'assetLibrary.pasteLink.errUpstream',
  'no-route': 'assetLibrary.pasteLink.errUpstream',
  'bad-response': 'assetLibrary.pasteLink.errBadResponse',
}

/** 指标语义 token → 文案键。UI 只认 token，不认平台（见文件头约束②）。 */
const METRIC_KEY: Record<ReferenceEvidence['metric'], string | null> = {
  none: null,
  collect: 'assetLibrary.findReference.metricCollect',
  like: 'assetLibrary.findReference.metricLike',
  ctr: 'assetLibrary.findReference.metricCtr',
  hot: 'assetLibrary.findReference.metricHot',
}

export type FindReferencePanelProps = {
  projectId: string | null
  platform: ReferencePlatform
  onPlatformChange: (platform: ReferencePlatform) => void
  /**
   * 输入的是分享链接时的出口——直接复用既有「贴链接导入」那条路，
   * 不在本组件里另写一份解析/下载/落盘（P1：无并行版）。
   */
  onShareLink: (text: string) => void
  /** 落成素材后回流刷新素材库。 */
  onImported: () => void
  /** 没配 key 时引导去设置。 */
  onNeedKey: () => void
  className?: string
}

export function FindReferencePanel({
  projectId,
  platform,
  onPlatformChange,
  onShareLink,
  onImported,
  onNeedKey,
  className,
}: FindReferencePanelProps): JSX.Element {
  const { t } = useTranslation()
  const [keyword, setKeyword] = React.useState('')
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<ReferenceSearchResult | null>(null)
  const [addingId, setAddingId] = React.useState<string | null>(null)
  const [addedIds, setAddedIds] = React.useState<ReadonlySet<string>>(new Set())
  const inputRef = React.useRef<HTMLDivElement | null>(null)

  /** 把焦点送回输入框——「改」与「换个词」都是同一个动作：回去改那个词。 */
  const focusKeyword = React.useCallback(() => {
    inputRef.current?.querySelector('input')?.focus()
  }, [])

  const platformName = t(`assetLibrary.findReference.platform.${platform}`)

  const runSearch = React.useCallback(async (periodDays?: number) => {
    const term = keyword.trim()
    if (!term || running) return
    // 一个输入框两种意图：贴链接 = 我已经知道要哪条；输关键词 = 我还不知道。
    // 链接交给既有导入路径（它自己会校验平台与口令文本）。
    if (/https?:\/\//i.test(term)) {
      onShareLink(term)
      return
    }
    const bridge = getDesktopBridge()
    if (!bridge?.connector?.tikhub) return
    setRunning(true)
    try {
      const next = await bridge.connector.tikhub.searchReferences({ platform, keyword: term, periodDays })
      setResult(next)
    } catch (error) {
      const kind = tikhubErrorKindOf(error)
      if (kind === 'missing-key') onNeedKey()
      toast(t(ERROR_KEY[kind ?? 'bad-response'] ?? ERROR_KEY['bad-response']), 'error')
    } finally {
      setRunning(false)
    }
  }, [keyword, onNeedKey, onShareLink, platform, running, t])

  /**
   * 「加入素材库」不可用的原因（null = 可用）。
   *
   * §1.6 C1：**有目标守卫的控件必须 disabled + 说清为什么**。
   * 2026-09-08 真机走查抓到：这里原本是 `if (!projectId) return` 静默早退——
   * 点了按钮什么都不发生、没有 toast、没有控制台错误、按钮文案不变。
   * 用户唯一能得到的结论是「这软件坏了」。
   */
  const blockedReason = React.useMemo((): string | null => {
    if (!projectId) return t('assetLibrary.findReference.needProject')
    if (!getDesktopBridge()?.connector?.tikhub) return t('assetLibrary.findReference.desktopOnly')
    return null
  }, [projectId, t])

  const addToLibrary = React.useCallback(async (item: ReferenceItem) => {
    if (blockedReason || addingId) return
    const bridge = getDesktopBridge()
    if (!bridge?.connector?.tikhub) return
    setAddingId(item.id)
    try {
      await bridge.connector.tikhub.importReference({ projectId: projectId as string, platform: item.platform, itemId: item.id })
      setAddedIds((prev) => new Set(prev).add(item.id))
      toast(t('assetLibrary.findReference.added'), 'success')
      onImported()
    } catch (error) {
      const kind = tikhubErrorKindOf(error)
      toast(t(ERROR_KEY[kind ?? 'bad-response'] ?? ERROR_KEY['bad-response']), 'error')
    } finally {
      setAddingId(null)
    }
  }, [addingId, blockedReason, onImported, projectId, t])

  const isEmptyResult = result !== null && result.items.length === 0

  return (
    <div className={cn('border-t border-nomi-line bg-nomi-bg', className)} data-find-reference-panel>
      {/* 平台行：项目级设定，不是筛选器 */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-2">
        <span className="shrink-0 text-micro text-nomi-ink-40">{t('assetLibrary.findReference.platformLabel')}</span>
        {REFERENCE_PLATFORMS.map((id) => (
          <button
            key={id}
            type="button"
            data-platform={id}
            data-active={id === platform}
            aria-pressed={id === platform}
            className={cn(
              'h-6 rounded-full border px-2.5 text-caption transition-[background,color,border-color] duration-nomi-fast ease-nomi-fast',
              id === platform
                ? 'border-nomi-accent bg-nomi-accent-soft font-semibold text-nomi-accent'
                : 'border-nomi-line bg-nomi-paper text-nomi-ink-60 hover:text-nomi-ink',
              id === platform && 'cursor-default',
            )}
            // 当前平台那颗**本来就点不动**（你没法「切到」你已经在的平台）。
            // 写成 disabled 而不是 handler 里 `if (id === platform) return`：
            // 后者是 §1.6 C1 明令禁止的静默守卫（check:controls 会红），而且点当前平台
            // 若走进 setResult(null) 还会把用户的结果白白清掉。
            disabled={id === platform}
            title={id === platform ? t('assetLibrary.findReference.currentPlatform') : undefined}
            onClick={() => {
              // 换平台必须清结果：证据格 / 筛选维度 / 要不要转译**都随平台 derive**，
              // 留着上一个平台的列表 = 用户以为「这就是新平台上的片子」。
              // 2026-09-08 走查实拍：切到 TikTok 后列表还是抖音的，副行仍写着「收藏」——
              // 而收藏是抖音/小红书的指标，TikTok 广告库根本没有这个数。
              setResult(null)
              setAddedIds(new Set())
              onPlatformChange(id)
            }}
          >
            {t(`assetLibrary.findReference.platform.${id}`)}
          </button>
        ))}
        <span className="flex-1" />
        <span className="text-micro text-nomi-ink-30">{t('assetLibrary.findReference.projectScope')}</span>
      </div>

      <div className="px-3 pb-2" ref={inputRef}>
        <DesignSearchInput
          className="w-full"
          value={keyword}
          onChange={setKeyword}
          placeholder={t('assetLibrary.findReference.placeholder')}
          ariaLabel={t('assetLibrary.findReference.entry')}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') void runSearch() }}
        />
      </div>

      {/* 转译回显：不回显 = 用户不知道结果为什么长这样 */}
      {result?.translationReason ? (
        <div className="px-3 pb-2 text-caption text-nomi-ink-40">
          {t('assetLibrary.findReference.translated', {
            term: result.effectiveKeyword,
            reason: t(`assetLibrary.findReference.reason.${result.translationReason}`),
          })}
          {' · '}
          <button type="button" className="text-nomi-accent hover:underline" onClick={focusKeyword}>
            {t('assetLibrary.findReference.editTerm')}
          </button>
        </div>
      ) : null}

      {running ? (
        <div className="px-3 pb-3 text-caption text-nomi-ink-40" role="status">
          {t('assetLibrary.findReference.searching')}
        </div>
      ) : isEmptyResult ? (
        // 三段式：发生什么 / 为什么 / 下一步。「不是搜坏了」这句必须有——
        // 实测 keyword+period=30 真的会返回 0 条，没这句用户会判定功能坏了。
        <div className="mx-3 mb-3 rounded-nomi-sm border border-nomi-warning/40 bg-nomi-warning-soft px-3 py-2.5" role="status">
          <div className="text-body-sm font-semibold text-nomi-ink">{t('assetLibrary.findReference.noResultTitle')}</div>
          <div className="mt-1 text-caption leading-relaxed text-nomi-ink-60">
            {t('assetLibrary.findReference.noResultBody', { platform: platformName })}
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              className="h-8 rounded-nomi-sm bg-nomi-ink px-3 text-body-sm font-medium text-nomi-paper hover:bg-nomi-accent"
              onClick={() => void runSearch(180)}
            >
              {t('assetLibrary.findReference.widen')}
            </button>
            <button
              type="button"
              className="h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 text-body-sm font-medium text-nomi-ink-80 hover:bg-nomi-ink-05"
              onClick={focusKeyword}
            >
              {t('assetLibrary.findReference.changeTerm')}
            </button>
          </div>
        </div>
      ) : result ? (
        <div className="grid grid-cols-3 gap-2 px-3 pb-3">
          {result.items.map((item) => (
            <ReferenceCard
              key={item.id}
              item={item}
              added={addedIds.has(item.id)}
              adding={addingId === item.id}
              blockedReason={blockedReason}
              onAdd={() => void addToLibrary(item)}
            />
          ))}
        </div>
      ) : (
        <div className="px-3 pb-3 text-micro text-nomi-ink-40">{t('assetLibrary.findReference.hint')}</div>
      )}

      {/* 诚实标注（D4：缺口明着标）——落进项目的参考素材 usageStatus 是 reference_only。 */}
      {result && result.items.length > 0 ? (
        <div className="px-3 pb-2.5 text-micro text-nomi-ink-30">{t('assetLibrary.findReference.referenceOnly')}</div>
      ) : null}
    </div>
  )
}

/** 一张参考卡。**不认识平台**——只按 evidence 顺序渲染。 */
function ReferenceCard({
  item,
  added,
  adding,
  blockedReason,
  onAdd,
}: {
  item: ReferenceItem
  added: boolean
  adding: boolean
  /** 非 null = 现在加不了，这句话就是原因（§1.6 C1：点不了必须说清为什么）。 */
  blockedReason: string | null
  onAdd: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const scale = item.evidence[0]
  const hot = item.evidence.find((e) => e.kind === 'hot')
  const second = item.evidence.filter((e) => e !== scale && e !== hot)[0]
  const label = (e: ReferenceEvidence): string => {
    const key = METRIC_KEY[e.metric]
    return key ? `${t(key)} ${e.value}`.trim() : e.value
  }

  return (
    <div className="relative overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper" data-ref-id={item.id}>
      <div className="relative grid aspect-[9/16] place-items-center bg-nomi-ink-10">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <IconPhoto size={22} stroke={1.5} className="text-nomi-ink-30" />
        )}
        {scale ? (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--nomi-overlay-chip)] px-2 py-0.5 text-micro leading-none text-white">
            {label(scale)}
          </span>
        ) : null}
        {hot ? (
          <span className="absolute left-1.5 top-[26px] inline-flex items-center gap-1 rounded-full bg-[var(--nomi-warning)] px-1.5 py-0.5 text-micro leading-none text-white">
            <IconTrendingUp size={10} stroke={1.8} aria-hidden="true" />
            {t('assetLibrary.findReference.metricHot')}
          </span>
        ) : null}
        <span className="absolute bottom-1 right-1 rounded-nomi-sm bg-[var(--nomi-media-veil)] px-1.5 py-px text-micro text-white">
          {item.mediaKind === 'image' ? t('assetLibrary.findReference.imagePost') : item.durationLabel}
        </span>
      </div>
      <div className="line-clamp-2 px-1.5 pb-1 pt-1.5 text-micro leading-snug text-nomi-ink-60">{item.caption}</div>
      {second ? <div className="px-1.5 pb-1 text-micro text-nomi-ink-40">{label(second)}</div> : null}
      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        <span title={blockedReason ?? undefined} style={{ display: 'contents' }}>
        <button
          type="button"
          disabled={added || adding || Boolean(blockedReason)}
          data-added={added}
          data-blocked={blockedReason ? 'true' : 'false'}
          className={cn(
            'inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-nomi-sm text-micro font-medium',
            added
              ? 'cursor-default bg-nomi-ink-05 text-nomi-ink-40'
              : 'bg-nomi-ink text-nomi-paper hover:enabled:bg-nomi-accent disabled:opacity-60',
          )}
          onClick={onAdd}
        >
          {added ? t('assetLibrary.findReference.added') : (
            <>
              <IconPlus size={11} stroke={2} aria-hidden="true" />
              {t('assetLibrary.findReference.addToLibrary')}
            </>
          )}
        </button>
        </span>
        {item.pageUrl ? (
          <a
            href={item.pageUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={t('assetLibrary.findReference.openOriginal')}
            title={t('assetLibrary.findReference.openOriginal')}
            className="grid size-6 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
          >
            <IconExternalLink size={12} stroke={1.7} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  )
}
