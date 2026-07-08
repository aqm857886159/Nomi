import React from 'react'
import { Popover } from '@mantine/core'
import {
  IconChevronDown,
  IconVideo,
  IconZoomIn,
  IconZoomOut,
  IconZoomInArea,
  IconZoomOutArea,
  IconFocusCentered,
  IconRotate,
  IconRotateClockwise,
  IconArrowBigUpLines,
  IconArrowBigDownLines,
  IconArrowNarrowLeft,
  IconArrowNarrowRight,
  IconArrowRampLeft,
  IconArrowRampRight,
  IconPlus,
  type Icon,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { toast } from '../../../ui/toast'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  CAMERA_MOVES,
  CAMERA_MOVE_LABEL,
  CAMERA_SPEED_DURATION,
  type CameraMove,
  type CameraSpeed,
  type StagingShot,
} from './scene3d/cameraMoveVocab'
import { createCameraMoveReferenceNode } from './scene3d/cameraMoveReferenceNode'

// 手动运镜控件（B1）：视频镜头 composer 底栏的一枚「运镜」芯片 + 弹层，是 AI 工具 create_camera_move
// 的**第二道门**——不搭 3D 场景，选个精确运镜 + 速度 + 景别，一键建灰模运镜小片自动接入本镜的
// video_ref。产路与 AI 工具共用 createCameraMoveReferenceNode（单一真相源，P1/P4）；运镜表/标签/
// 速度/景别一律 derive 自 cameraMoveVocab，绝不重打（P2）。见 docs/plan/2026-06-22-ai-camera-move-tool.md。

// 运镜 → 图标（纯展示层映射；运镜集合本身仍来自 CAMERA_MOVES，这里只补每个 move 的视觉符号）。
const MOVE_ICON: Record<CameraMove, Icon> = {
  push_in: IconZoomIn,
  pull_out: IconZoomOut,
  orbit_left: IconRotate,
  orbit_right: IconRotateClockwise,
  crane_up: IconArrowBigUpLines,
  crane_down: IconArrowBigDownLines,
  track_left: IconArrowNarrowLeft,
  track_right: IconArrowNarrowRight,
  arc_left: IconArrowRampLeft,
  arc_right: IconArrowRampRight,
  zoom_in: IconZoomInArea,
  zoom_out: IconZoomOutArea,
  dolly_zoom: IconFocusCentered,
}

// 速度：慢/中/快 → slow/medium/fast（值来自 CAMERA_SPEED_DURATION 的键，时长从表里读，不硬编）。
const SPEED_ORDER: CameraSpeed[] = ['slow', 'medium', 'fast']
const SPEED_LABEL: Record<CameraSpeed, string> = { slow: '慢', medium: '中', fast: '快' }
// 景别：远/中/近 → wide/medium/close（StagingShot 三档，与 cameraMoveVocab 的 CAMERA_MOVE_FRAMING 同键）。
const SHOT_ORDER: StagingShot[] = ['wide', 'medium', 'close']
const SHOT_LABEL: Record<StagingShot, string> = { wide: '远', medium: '中', close: '近' }

const DEFAULT_MOVE: CameraMove = 'push_in'
const DEFAULT_SPEED: CameraSpeed = 'medium'
const DEFAULT_SHOT: StagingShot = 'medium'

function isCameraMove(v: unknown): v is CameraMove {
  return typeof v === 'string' && (CAMERA_MOVES as string[]).includes(v)
}
function isSpeed(v: unknown): v is CameraSpeed {
  return typeof v === 'string' && (SPEED_ORDER as string[]).includes(v)
}
function isShot(v: unknown): v is StagingShot {
  return typeof v === 'string' && (SHOT_ORDER as string[]).includes(v)
}

type CameraMovePick = { move: CameraMove; speed: CameraSpeed; shot: StagingShot }

/** 从 node.meta 读上次选择（无则默认），供芯片回显 + 弹层初值。 */
function readPick(meta: Record<string, unknown> | undefined): CameraMovePick {
  const raw = (meta?.cameraMovePick as Record<string, unknown> | undefined) || {}
  return {
    move: isCameraMove(raw.move) ? raw.move : DEFAULT_MOVE,
    speed: isSpeed(raw.speed) ? raw.speed : DEFAULT_SPEED,
    shot: isShot(raw.shot) ? raw.shot : DEFAULT_SHOT,
  }
}

// 分段按钮（速度/景别共用）：token-only，data-[active] 高亮，与 ModeBar/文本模式切换同语汇。
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1 w-full')}>
      <span className={cn('text-nomi-ink-40 text-micro leading-none')}>{label}</span>
      <div
        className={cn('inline-flex gap-0.5 p-0.5 rounded-nomi-sm bg-nomi-ink-05 self-start')}
        role="group"
        aria-label={label}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            data-active={value === option.value ? 'true' : 'false'}
            className={cn(
              'rounded-nomi-sm px-3 py-1 text-caption leading-none',
              'text-nomi-ink-60 cursor-pointer transition-colors',
              'data-[active=true]:bg-nomi-paper data-[active=true]:text-nomi-ink',
              'data-[active=true]:font-semibold data-[active=true]:shadow-nomi-sm',
            )}
            onClick={(event) => {
              event.stopPropagation()
              onChange(option.value)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function NodeCameraMoveControl({ node }: { node: GenerationCanvasNode }): JSX.Element {
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const [open, setOpen] = React.useState(false)
  // 弹层内的草稿选择（打开时从 meta 初始化）——落节点只在「应用」时写，避免每点一下就写盘/串态。
  const [draft, setDraft] = React.useState<CameraMovePick>(() => readPick(node.meta))
  React.useEffect(() => {
    if (open) setDraft(readPick(node.meta))
  }, [open, node.meta])

  const saved = readPick(node.meta)
  // 芯片标签：上次「应用」过的运镜 · 速度（如「运镜 · 推近 慢」）。
  const chipSummary = `${CAMERA_MOVE_LABEL[saved.move]} ${SPEED_LABEL[saved.speed]}`
  const duration = CAMERA_SPEED_DURATION[draft.speed]

  // 单一真相源写法：从 store 读最新 meta 再 spread（防 lost-update 竞态，与 NodeParameterControls 同规）。
  const getLatestMeta = (): Record<string, unknown> =>
    useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)?.meta || {}

  const handleApply = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    // 落上次选择到本节点 meta（芯片回显 + 下次打开的初值），再建灰模运镜片自动接入本镜 video_ref。
    updateNode(node.id, { meta: { ...getLatestMeta(), cameraMovePick: { ...draft } } })
    // 与 AI 工具 create_camera_move 共用同一核心：建 scene3d 节点 + cameraMoveAutoCapture 标志，
    // 常驻 CameraMoveCaptureHost 离屏出 mp4 并喂给本视频节点作 video_ref（P1/P4，不另起接缝）。
    createCameraMoveReferenceNode({
      spec: { move: draft.move, speed: draft.speed, shot: draft.shot },
      targetNodeId: node.id,
    })
    toast(`已生成「${CAMERA_MOVE_LABEL[draft.move]} · ${SPEED_LABEL[draft.speed]} · ${duration}s」运镜片，正在离屏渲染并接入本镜运镜参考。`, 'success')
    setOpen(false)
  }

  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="bottom-start"
      offset={6}
      withinPortal
      shadow="md"
      radius="md"
    >
      <Popover.Target>
        <button
          type="button"
          aria-label="运镜"
          title="运镜：不用搭 3D 场景，一键生成灰模运镜片接入本镜"
          onClick={(event) => {
            event.stopPropagation()
            setOpen((prev) => !prev)
          }}
          className={cn(
            'inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-pill border border-nomi-line bg-nomi-paper',
            'text-caption text-nomi-ink-80 cursor-pointer hover:border-nomi-ink-20 focus:outline-none focus-visible:border-nomi-accent',
          )}
        >
          <IconVideo size={13} stroke={1.6} className="shrink-0 text-nomi-ink-40" aria-hidden />
          <span className="shrink-0">运镜</span>
          <span className="text-nomi-ink-40" aria-hidden>·</span>
          <span className="shrink-0 whitespace-nowrap">{chipSummary}</span>
          <IconChevronDown size={12} stroke={1.6} className="shrink-0 text-nomi-ink-40 pointer-events-none" aria-hidden />
        </button>
      </Popover.Target>
      <Popover.Dropdown
        onClick={(event) => event.stopPropagation()}
        styles={{
          dropdown: {
            padding: 12,
            border: '1px solid var(--nomi-line)',
            borderRadius: 'var(--nomi-radius-lg)',
            background: 'var(--nomi-paper)',
            boxShadow: 'var(--workbench-shadow-pop)',
          },
        }}
      >
        <div className={cn('flex flex-col gap-3 w-[300px]')}>
          {/* 标题 + hint（对齐样张：标题「运镜」+ 副「不用搭 3D 场景」）。 */}
          <div className={cn('flex flex-col gap-0.5')}>
            <span className={cn('text-body-sm font-semibold text-nomi-ink')}>运镜</span>
            <span className={cn('text-micro text-nomi-ink-40')}>不用搭 3D 场景</span>
          </div>

          {/* (1) 10 个精确运镜网格：图标 + 标签，单选。集合来自 CAMERA_MOVES，标签来自 CAMERA_MOVE_LABEL。 */}
          <div className={cn('grid grid-cols-5 gap-1')} role="group" aria-label="运镜类型">
            {CAMERA_MOVES.map((move) => {
              const IconCmp = MOVE_ICON[move]
              const isActive = draft.move === move
              return (
                <button
                  key={move}
                  type="button"
                  aria-pressed={isActive}
                  data-active={isActive ? 'true' : 'false'}
                  title={CAMERA_MOVE_LABEL[move]}
                  className={cn(
                    'flex flex-col items-center gap-1 py-1.5 rounded-nomi-sm border border-transparent',
                    'text-nomi-ink-60 cursor-pointer transition-colors hover:bg-nomi-ink-05',
                    'data-[active=true]:border-nomi-accent data-[active=true]:bg-nomi-accent-soft data-[active=true]:text-nomi-accent',
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    setDraft((prev) => ({ ...prev, move }))
                  }}
                >
                  <IconCmp size={18} stroke={1.6} aria-hidden />
                  <span className={cn('text-micro leading-none')}>{CAMERA_MOVE_LABEL[move]}</span>
                </button>
              )
            })}
          </div>

          {/* (2) 速度 慢/中/快 → slow/medium/fast。 */}
          <Segmented
            label="速度"
            value={draft.speed}
            options={SPEED_ORDER.map((speed) => ({ value: speed, label: SPEED_LABEL[speed] }))}
            onChange={(speed) => setDraft((prev) => ({ ...prev, speed }))}
          />

          {/* (3) 景别 远/中/近 → wide/medium/close。 */}
          <Segmented
            label="景别"
            value={draft.shot}
            options={SHOT_ORDER.map((shot) => ({ value: shot, label: SHOT_LABEL[shot] }))}
            onChange={(shot) => setDraft((prev) => ({ ...prev, shot }))}
          />

          {/* (4) 「叠一层」——脚手架占位（敬请期待）。禁用态，不引入并行产路（P1）。 */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="叠加第二段运镜——敬请期待"
            className={cn(
              'inline-flex items-center justify-center gap-1 h-7 rounded-pill border border-dashed border-nomi-line',
              'text-caption text-nomi-ink-40 self-start px-3 cursor-not-allowed opacity-70',
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <IconPlus size={12} stroke={1.6} aria-hidden />
            叠一层
            <span className={cn('text-micro text-nomi-ink-40')}>敬请期待</span>
          </button>

          {/* (5) 底部读出 + 应用：readout 由当前草稿 derive（运镜 · 速度 · 秒 → 灰模片接入 video_ref）。 */}
          <div className={cn('flex items-center gap-2 pt-1 border-t border-nomi-line-soft')}>
            <span className={cn('flex-1 text-micro text-nomi-ink-60 leading-[1.35]')}>
              {CAMERA_MOVE_LABEL[draft.move]} · {SPEED_LABEL[draft.speed]} · {duration}s → 灰模运镜片自动接入 video_ref
            </span>
            <button
              type="button"
              className={cn(
                'shrink-0 inline-flex items-center h-7 px-3 rounded-pill',
                'bg-nomi-accent text-nomi-paper text-caption font-medium cursor-pointer',
                'hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent',
              )}
              onClick={handleApply}
            >
              应用
            </button>
          </div>
        </div>
      </Popover.Dropdown>
    </Popover>
  )
}
