// 设计实验室 · primitive 陈列 · 浮层族。
//
// 这一族**全部** `capture: 'viewport'`：Modal / Drawer / AnchoredPopover / Radix Tooltip
// 都 Portal 到 body 并 fixed 定位，根本不在舞台的 DOM 子树里——按元素截会截出
// 「浮层没打开」的假证据（同 hostConfig 屏 toast 那一族的理由）。
//
// 优化方案 D-1 把「原生 WorkbenchDialog 缺失、30+ 文件手写 role=dialog」列为缺失原语；
// 这几格是那条结论的对照物：设计系统**已经有**的浮层原语长什么样，摆在这里。
import React from 'react'
import { IconInfoCircle } from '@tabler/icons-react'

import {
  AnchoredPopover,
  ConfirmDialogHost,
  DesignDrawer,
  DesignModal,
  DesignTextInput,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  WorkbenchButton,
  confirmDialog,
} from '../../../../design'
import type { LabState } from '../../labScreen'

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
      <DesignModal opened onClose={() => undefined} title="重命名项目" centered>
        <div className="flex flex-col gap-3">
          <DesignTextInput label="项目名称" defaultValue="夏日短片" />
          <div className="flex justify-end gap-2">
            <WorkbenchButton>取消</WorkbenchButton>
            <WorkbenchButton variant="primary">保存</WorkbenchButton>
          </div>
        </div>
      </DesignModal>
    </OverlayBackdrop>
  )
}

function DrawerSpecimen(): JSX.Element {
  return (
    <OverlayBackdrop note="DesignDrawer（全仓零调用；抽屉与 Modal 是同一根轴上的两种取景）">
      <DesignDrawer opened onClose={() => undefined} position="right" size={360} title="镜头属性">
        <div className="flex flex-col gap-3">
          <DesignTextInput label="镜头名称" defaultValue="03 · 海边逆光" />
          <DesignTextInput label="时长（秒）" defaultValue="5" />
        </div>
      </DesignDrawer>
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
        <AnchoredPopover anchorRef={anchorRef} align="start" gap={6}>
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
      <div className="mt-6 self-start">
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger asChild>
              <WorkbenchButton>
                <IconInfoCircle /> 为什么点不了
              </WorkbenchButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">正在导出，导出结束后可再次点击</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
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
    name: 'DesignModal · 打开态',
    source: SOURCE_OVERLAYS,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <ModalSpecimen />,
  },
  {
    id: 'ps-08-drawer',
    name: 'DesignDrawer · 右侧打开态（全仓零调用）',
    source: SOURCE_OVERLAYS,
    coverage: 'component-only',
    capture: 'viewport',
    render: () => <DrawerSpecimen />,
  },
  {
    id: 'ps-09-anchored-popover',
    name: 'AnchoredPopover · 贴锚点展开',
    source: SOURCE_OVERLAYS,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <AnchoredPopoverSpecimen />,
  },
  {
    id: 'ps-10-tooltip',
    name: 'TooltipContent · 常开态',
    source: SOURCE_OVERLAYS,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <TooltipSpecimen />,
  },
  {
    id: 'ps-11-confirm-dialog',
    name: 'confirmDialog · 危险动作确认（danger）',
    source: 'src/design/confirmDialog.tsx · docs/design/nomi-design-system.md §3.5',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <ConfirmDialogSpecimen />,
  },
]
