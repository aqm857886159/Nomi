// 设计实验室 · primitive 陈列 · 浮层族。
//
// 这一族**全部** `capture: 'viewport'`：Modal / AnchoredPopover / Radix Tooltip
// 都 Portal 到 body 并 fixed 定位，根本不在舞台的 DOM 子树里——按元素截会截出
// 「浮层没打开」的假证据（同 hostConfig 屏 toast 那一族的理由）。
//
// 优化方案 D-1 把「原生 WorkbenchDialog 缺失、30+ 文件手写 role=dialog」列为缺失原语；
// 这几格是那条结论的对照物：设计系统**已经有**的浮层原语长什么样，摆在这里。
//
// ⚠️ 2026-09-07（用户抓到的系统性缺陷）：陈列「渲染的是现役组件本体」只管住了**组件**，
// 管不住 **props**。这一族三处失真已按真实调用点改回：
//   · `DesignModal` 漏了 `size`（6/6 真实调用点都传），页脚也换成生产真用的手写按钮；
//   · `AnchoredPopover` 漏了 `onClose`——**2/2** 真实调用点都传，而它正是「点外面/Esc 关掉」
//     的接线口（组件头注 :47）。不传就是陈列一个关不掉的浮层；
//   · `Tooltip` 此前 `open` 强开、包着一颗文字按钮、内容是整句话。真实用法 **19/19** 都是
//     悬停触发的图标钮 + 短标签，禁用时还要外包一层 `<span className="inline-flex">`
//     （禁用元素不触发 hover）。整句话那种得自己覆写 `whitespace-normal`，
//     此前那格没覆写——照抄它会得到一条跑出屏幕的单行提示。
import React from 'react'
import { IconDeviceFloppy, IconInfoCircle, IconX } from '@tabler/icons-react'

import {
  AnchoredPopover,
  ConfirmDialogHost,
  DesignModal,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  WorkbenchButton,
  confirmDialog,
} from '../../../../design'
import { cn } from '../../../../utils/cn'
import type { LabState } from '../../labScreen'

/** 与 `WorkflowLibraryContent.tsx:186-190` 的 `inputClass` 同一串——那是生产手写的表单壳。 */
const MODAL_INPUT_CLASS = cn(
  'w-full rounded-nomi border border-nomi-line bg-nomi-paper px-2.5 py-1.5 text-body-sm text-nomi-ink',
  'placeholder:text-nomi-ink-40 focus:border-nomi-accent focus:outline-none',
)

// ps-08（DesignDrawer）于 2026-09-07 随组件删除：全仓零调用、且 Nomi 没有抽屉形态。空号不补位。
const SOURCE_OVERLAYS = 'src/design/overlays.tsx + AnchoredPopover.tsx + tooltip.tsx · 优化方案 D-1 浮层原语'

/** 浮层格共用的底：浮层自己 fixed 到视口，舞台只提供一块可辨认的页面背景。 */
function OverlayBackdrop({ children, note }: { children?: React.ReactNode; note: string }): JSX.Element {
  return (
    <div
      data-design-lab-stage="primitive-overlay"
      className="flex h-[520px] w-[900px] flex-col gap-2 rounded-nomi border border-nomi-line bg-nomi-bg p-5 text-nomi-ink"
    >
      <div className="text-caption text-nomi-ink-40">{note}</div>
      {children}
    </div>
  )
}

function ModalSpecimen(): JSX.Element {
  return (
    <OverlayBackdrop note="DesignModal（Mantine Modal + token 外壳，zIndex 走 overlayLayers.dialog）">
      <DesignModal opened onClose={() => undefined} title="编辑工作流" centered size="md">
        {/* 逐项照抄 WorkflowLibraryContent:192 的整个正文：三个字段（名称 / 说明 / 标签）+
            右下角一对**手写**药丸钮（带图标）。输入框与按钮在生产里都是手写的，
            那是 D-1 记的债（缺 WorkbenchDialog / 表单原语）——陈列照实画，不替生产美化成
            DesignTextInput + WorkbenchButton，那会画出一个不存在的弹窗。 */}
        <div className="grid gap-3">
          <input
            className={MODAL_INPUT_CLASS}
            defaultValue="夏日短片 · 分镜工作流"
            maxLength={80}
            aria-label="工作流名称"
          />
          <textarea
            className={cn(MODAL_INPUT_CLASS, 'min-h-20 resize-y leading-relaxed')}
            defaultValue="从一句话拆十镜，逐镜生图再连视频。"
            maxLength={240}
            aria-label="工作流说明"
          />
          <input
            className={MODAL_INPUT_CLASS}
            defaultValue="短片, 分镜, 图生视频"
            maxLength={160}
            aria-label="标签"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-full border-0 bg-transparent px-3 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink"
            >
              <IconX size={14} stroke={1.8} aria-hidden="true" />
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border-0 bg-nomi-ink px-3.5 text-caption font-medium text-nomi-paper hover:bg-nomi-accent"
            >
              <IconDeviceFloppy size={14} stroke={1.8} aria-hidden="true" />
              保存
            </button>
          </div>
        </div>
      </DesignModal>
    </OverlayBackdrop>
  )
}

function AnchoredPopoverSpecimen(): JSX.Element {
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const [ready, setReady] = React.useState(false)
  // 首帧先把锚点渲出来，第二帧再开浮层——`AnchoredPopover` 要量锚点的 rect 才定得了位。
  React.useLayoutEffect(() => setReady(true), [])
  return (
    <OverlayBackdrop note="AnchoredPopover（Portal 到 body + fixed 贴锚点，逃出祖先 overflow 裁切）">
      <div className="mt-6 self-start">
        <WorkbenchButton ref={anchorRef}>参考图设置</WorkbenchButton>
      </div>
      {ready ? (
        <AnchoredPopover anchorRef={anchorRef} align="center" gap={6} onClose={() => undefined}>
          <div className="w-[260px] rounded-nomi border border-nomi-line bg-nomi-paper p-3 shadow-nomi-md">
            <div className="text-body-sm font-medium">参考强度</div>
            <div className="mt-1 text-caption text-nomi-ink-60">越高越贴近参考图的构图与配色。</div>
          </div>
        </AnchoredPopover>
      ) : null}
    </OverlayBackdrop>
  )
}

function TooltipSpecimen(): JSX.Element {
  return (
    <OverlayBackdrop note="TooltipContent（Radix Portal；本仓浮层的第三套定位机制之一）">
      {/* Provider 的真实位置是**外壳级**，且带调好的 delay（NomiAppBar:222），不是每颗按钮各包一个。

          `open` 是**取景手段**，不是形态主张：19/19 真实调用点都是悬停触发的非受控 tooltip，
          但截图截不到鼠标悬停，气泡不打开这一格就是一张空舞台（走查那条断言防的正是它）。
          同 `OpenPopoverStage` 用一次真点击把下拉定住——这里用 `open` 把气泡定住，
          定住的**内容与触发器形状**仍是真实的那三种。 */}
      <TooltipProvider delayDuration={250} disableHoverableContent>
        <div className="mt-6 flex flex-col items-start gap-14 self-start pl-32">
          {/* ① 主形态：图标钮 + 短标签（真实调用点的主流形态）。 */}
          <Tooltip open>
            <TooltipTrigger asChild>
              <WorkbenchButton aria-label="说明">
                <IconInfoCircle />
              </WorkbenchButton>
            </TooltipTrigger>
            <TooltipContent side="top">导出为 MP4</TooltipContent>
          </Tooltip>
          {/* ② 禁用钮：Radix 收不到禁用元素的 hover，生产统一在外面套一层
                `<span className="inline-flex">` 当触发器（CanvasNavigationTooltipButton:33）。 */}
          <Tooltip open>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <WorkbenchButton aria-label="导出" aria-disabled className="cursor-not-allowed opacity-50">
                  <IconInfoCircle /> 导出
                </WorkbenchButton>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">正在导出，结束后可再次点击</TooltipContent>
          </Tooltip>
          {/* ③ 长文案：`TooltipContent` 自带 `whitespace-nowrap`，长句必须自己覆写，
                否则会拉成一条跑出屏幕的单行（3 处真实调用点逐字复制这套类）。 */}
          <Tooltip open>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <WorkbenchButton aria-label="提示词全文">
                  <IconInfoCircle />
                </WorkbenchButton>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-56 whitespace-normal leading-snug">
              黄昏的海边，少年逆光走向镜头。手持轻微晃动，暖色调，浅景深。
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </OverlayBackdrop>
  )
}

function ConfirmDialogSpecimen(): JSX.Element {
  // ConfirmDialogHost 是子组件：它的绑定 effect 先于本组件的 effect 跑，请求不会落进积压队列。
  // 即便顺序反了也不会出事——`confirmDialogStore` 有 preMountQueue 兜底。
  React.useEffect(() => {
    void confirmDialog({
      title: '删除这个镜头？',
      message: '删除后画布上的连线一并断开，可用 Cmd+Z 撤销。',
      confirmLabel: '删除',
      danger: true,
    })
  }, [])
  return (
    <OverlayBackdrop note="confirmDialog + ConfirmDialogHost（禁用原生 confirm/alert/prompt 的替代原语）">
      <ConfirmDialogHost />
    </OverlayBackdrop>
  )
}

export const OVERLAY_STATES: readonly LabState[] = [
  {
    id: 'ps-07-modal',
    name: 'DesignModal · 打开态（size 必传 · 正文与页脚都是手写件）',
    source: SOURCE_OVERLAYS,
    mirrors: ['src/workbench/library/WorkflowLibraryContent.tsx:192'],
    coverage: 'shell',
    capture: 'viewport',
    render: () => <ModalSpecimen />,
  },
  {
    id: 'ps-09-anchored-popover',
    name: 'AnchoredPopover · 贴锚点展开（onClose 是必需接线，不是可选装饰）',
    source: SOURCE_OVERLAYS,
    mirrors: ['src/workbench/timeline/TimelineTransitionPicker.tsx:41'],
    coverage: 'shell',
    capture: 'viewport',
    render: () => <AnchoredPopoverSpecimen />,
  },
  {
    id: 'ps-10-tooltip',
    name: 'TooltipContent · 图标钮 / 禁用外包 span / 长文案覆写（三种真实形态）',
    source: SOURCE_OVERLAYS,
    mirrors: [
      'src/workbench/generationCanvas/components/CanvasNavigationTooltipButton.tsx:32',
      'src/ui/app-shell/NomiAppBar.tsx:222',
      'src/workbench/promptLibrary/PromptCard.tsx:83',
    ],
    coverage: 'shell',
    capture: 'viewport',
    render: () => <TooltipSpecimen />,
  },
  {
    id: 'ps-11-confirm-dialog',
    name: 'confirmDialog · 危险动作确认（danger）',
    source: 'src/design/confirmDialog.tsx · docs/design/nomi-design-system.md §3.5',
    mirrors: ['src/ui/onboarding/CustomVendorManage.tsx:107'],
    coverage: 'shell',
    capture: 'viewport',
    render: () => <ConfirmDialogSpecimen />,
  },
]
