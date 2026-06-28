/**
 * 上手 4 步进度（被动指示，不带走查——引导走查归首页触发的 JourneyTour）。
 *
 * 形态：**停靠在顶栏右簇**的一颗紧凑「上手 N/4」入口（始终高、不遮画布、不撞 AI 启动器/
 * 时间轴/创作助手——工作区每个角落都被占了，顶栏是唯一干净又显眼的位置）。点开是下拉清单，
 * 四步随**真实行为**自动打勾：
 *   1 接入模型   = 有可用文本模型（hasTextModel）
 *   2 拆一个镜头 = 画布出现节点
 *   3 生成一张   = 任一节点 status === 'success'
 *   4 导出成片   = 一次 MP4 导出成功（TimelinePreview 处 markChecklistStep）
 *
 * 入口消失的三条退出路：① 4/4 全做完；② 用户点「不再提示」；③ 首次显示满 2 天仍未
 * 完成 → 自动永久关闭。后两条写 nomi:checklist-dismissed，关了不再回来（onboardingState）。
 * 打勾单调持久（localStorage）。渲染在 NomiAppBar 内（React 树内，保 --nomi-* token）。
 */
import React from 'react'
import { IconCheck, IconChevronDown, IconListCheck } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useHasTextModel } from '../library/useHasTextModel'
import { useJourneyTourStore } from './journeyTourStore'
import { DesignProgress } from '../../design'
import {
  type ChecklistStep,
  type ChecklistState,
  readChecklist,
  markChecklistStep,
  readChecklistCollapsed,
  writeChecklistCollapsed,
  isChecklistDismissed,
  markChecklistDismissed,
  isChecklistExpired,
} from './onboardingState'

type StepMeta = {
  key: ChecklistStep
  label: string
  hint: string
}

const STEPS: StepMeta[] = [
  { key: 'model', label: '接入模型', hint: '连一个 AI 服务（用你自己的 Key）。' },
  { key: 'storyboard', label: '拆一个镜头', hint: '在创作区说「拆成镜头」，铺成画布。' },
  { key: 'generated', label: '生成一张', hint: '在镜头卡里选模型，点「生成」出图。' },
  { key: 'exported', label: '导出成片', hint: '排进时间轴，右上「导出」输出 MP4。' },
]

const ALL_KEYS = STEPS.map((s) => s.key)

export function OnboardingChecklist(): JSX.Element | null {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const { hasTextModel: textModelReady } = useHasTextModel()
  // 引导旅途进行时让位：清单是被动进度，tour 在演同一条流程，两者同屏会叠成一团（真机走查抓出）。
  const journeyTourActive = useJourneyTourStore((state) => state.active)

  const live = React.useMemo<ChecklistState>(
    () => ({
      model: textModelReady === true,
      storyboard: nodes.length > 0,
      generated: nodes.some((node) => node.status === 'success'),
      exported: false, // 导出 fire-and-forget 无 live 源，只走 TimelinePreview 持久标记
    }),
    [textModelReady, nodes],
  )

  const [persisted, setPersisted] = React.useState<ChecklistState>(() => readChecklist())
  const [dismissed, setDismissed] = React.useState<boolean>(() => isChecklistDismissed())
  const [open, setOpen] = React.useState<boolean>(() => !readChecklistCollapsed())
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const [anchor, setAnchor] = React.useState<{ top: number; right: number } | null>(null)

  // live 新达成 → 落盘 + 刷新；跨组件写盘（导出）靠 storage/focus 回读。
  React.useEffect(() => {
    let changed = false
    for (const key of ALL_KEYS) {
      if (live[key] && !persisted[key]) {
        markChecklistStep(key)
        changed = true
      }
    }
    if (changed) setPersisted(readChecklist())
  }, [live, persisted])

  React.useEffect(() => {
    const sync = () => setPersisted(readChecklist())
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  const effective = React.useMemo<ChecklistState>(
    () => ({
      model: persisted.model || live.model,
      storyboard: persisted.storyboard || live.storyboard,
      generated: persisted.generated || live.generated,
      exported: persisted.exported || live.exported,
    }),
    [persisted, live],
  )

  const doneCount = ALL_KEYS.filter((key) => effective[key]).length
  const allDone = doneCount === ALL_KEYS.length
  const nextKey = STEPS.find((s) => !effective[s.key])?.key ?? null

  // 下拉锚定在触发钮正下方、右对齐（实测触发钮几何，精准跟随顶栏布局）。
  const measureAnchor = React.useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAnchor({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
  }, [])

  React.useEffect(() => {
    if (!open) return
    measureAnchor()
    window.addEventListener('resize', measureAnchor)
    return () => window.removeEventListener('resize', measureAnchor)
  }, [open, measureAnchor])

  // 点下拉外 → 关闭（不影响聚光，聚光有自己的 dismiss）。
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null
      if (el && el.closest('[data-onboarding-checklist-root]')) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])

  const toggleOpen = React.useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      writeChecklistCollapsed(!next)
      return next
    })
  }, [])

  const handleDismiss = React.useCallback(() => {
    markChecklistDismissed()
    setDismissed(true)
  }, [])

  // 首次显示落时间戳；满 2 天仍未完成 → 自动永久关闭（写持久标记，不再回来）。
  React.useEffect(() => {
    if (dismissed || allDone) return
    if (isChecklistExpired(Date.now())) {
      markChecklistDismissed()
      setDismissed(true)
    }
  }, [dismissed, allDone])

  if (allDone || journeyTourActive || dismissed) return null

  return (
    <div data-onboarding-checklist-root="true" className="contents">
      <button
        type="button"
        ref={triggerRef}
        onClick={toggleOpen}
        data-onboarding-checklist-trigger="true"
        aria-label={`上手 4 步，已完成 ${doneCount} / ${ALL_KEYS.length}`}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-2.5 cursor-pointer font-inherit',
          'rounded-nomi-sm border border-transparent bg-transparent',
          'text-body-sm text-nomi-ink-80 transition-[background,color] duration-[var(--nomi-transition-fast)]',
          'hover:bg-nomi-ink-05 hover:text-nomi-ink',
          open && 'bg-nomi-ink-05 text-nomi-ink',
        )}
      >
        <IconListCheck size={18} stroke={1.6} aria-hidden="true" />
        <span className="max-[700px]:hidden">上手</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-nomi-accent-soft text-nomi-accent text-micro font-semibold tabular-nums">
          {doneCount}/{ALL_KEYS.length}
        </span>
      </button>

      {open && anchor ? (
        <section
          data-onboarding-checklist="panel"
          aria-label="上手 4 步"
          style={{ top: anchor.top, right: anchor.right }}
          className={cn(
            'fixed z-[60] w-64 overflow-hidden',
            'rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-lg',
          )}
        >
          <header className="flex items-center gap-2 pl-4 pr-2 pt-3 pb-2">
            <span className="text-body font-semibold text-nomi-ink">上手 4 步</span>
            <span className="text-caption font-medium text-nomi-ink-40 tabular-nums">
              {doneCount} / {ALL_KEYS.length}
            </span>
            <button
              type="button"
              onClick={() => toggleOpen()}
              aria-label="收起"
              className={cn(
                'ml-auto grid place-items-center size-6 rounded-nomi-sm border-0 bg-transparent cursor-pointer',
                'text-nomi-ink-40 transition-colors hover:bg-nomi-ink-10 hover:text-nomi-ink',
              )}
            >
              <IconChevronDown size={16} stroke={1.8} aria-hidden="true" />
            </button>
          </header>

          <DesignProgress value={(doneCount / ALL_KEYS.length) * 100} size="xs" className="mx-4 mb-2" />

          <ul className="flex flex-col px-1.5 pb-2 m-0 list-none">
            {STEPS.map((step) => {
              const done = effective[step.key]
              const isNext = !done && step.key === nextKey
              return (
                <li
                  key={step.key}
                  data-step={step.key}
                  data-done={done ? 'true' : 'false'}
                  className={cn('flex flex-col gap-1.5 p-2 rounded-nomi-sm', isNext && 'bg-nomi-accent-soft')}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'shrink-0 grid place-items-center size-5 rounded-full mt-px',
                        done
                          ? 'bg-nomi-accent text-nomi-paper'
                          : isNext
                            ? 'border-2 border-nomi-accent'
                            : 'border-2 border-nomi-ink-20',
                      )}
                    >
                      {done ? <IconCheck size={12} stroke={1.8} aria-hidden="true" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={cn(
                          'block text-body-sm font-medium leading-snug',
                          done ? 'text-nomi-ink-40' : isNext ? 'text-nomi-accent' : 'text-nomi-ink',
                        )}
                      >
                        {step.label}
                      </span>
                      {!done ? (
                        <span className="block text-caption text-nomi-ink-40 leading-snug mt-px">{step.hint}</span>
                      ) : null}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="flex justify-end border-t border-nomi-line-soft px-3 py-2">
            <button
              type="button"
              onClick={handleDismiss}
              className={cn(
                'rounded-nomi-sm border-0 bg-transparent px-1.5 py-0.5 cursor-pointer',
                'text-caption text-nomi-ink-40 transition-colors hover:text-nomi-ink',
              )}
            >
              不再提示
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
