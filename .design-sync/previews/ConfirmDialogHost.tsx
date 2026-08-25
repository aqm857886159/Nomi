// ConfirmDialogHost —— 破坏性操作确认原语的全局宿主（设计系统 §3.5）。
// 背景：此前全仓 11 处 window.confirm/alert/prompt——视觉脱离设计系统、Playwright 自动 dismiss
// 导致删除链路永远测不到、Electron 下 macOS 有焦点丢失史。**原生三件套从此禁用。**
//
// 用法不是「渲染这个组件」：App 根部挂一次，业务代码调 promise 风格的
// confirmDialog / alertDialog / promptDialog（都从 'nomi' 导出），多请求按序排队。
//
// 预览做法：挂上 Host，再调用真实的 store API 把卡打开——走的是和生产完全同一条
// 渲染管线（confirmDialog → Host → DesignModal → Mantine Modal），不是仿造的壳。
// 卡配了 cardMode:"single" + viewport，展开态才留在卡里。
import React from 'react'
import { ConfirmDialogHost, confirmDialog, alertDialog, promptDialog } from 'nomi'

/** 挂 Host + 打开一个真实请求；unmount 时把 promise 收干净。 */
function Host({ open }: { open: () => Promise<unknown> }): JSX.Element {
  React.useEffect(() => {
    void open()
  }, [open])
  return <ConfirmDialogHost />
}

/** 危险确认：删除项目。danger 让确认键走警示色。 */
export const DangerConfirm = (): JSX.Element => (
  <Host
    open={() =>
      confirmDialog({
        title: '删除这个项目？',
        message: '「海边黄昏」以及它的 6 个镜头、生成记录都会被删除。\n这个操作没法撤销。',
        confirmLabel: '删除',
        cancelLabel: '再想想',
        danger: true,
        tone: 'danger',
      })
    }
  />
)

/** 信息确认：非破坏性的二次确认，tone=info 走 accent 图标。 */
export const InfoConfirm = (): JSX.Element => (
  <Host
    open={() =>
      confirmDialog({
        title: '这一批要花 ¥1.68',
        message: '6 个镜头，用 Seedream 4.0 生成。继续吗？',
        confirmLabel: '继续生成',
        tone: 'info',
      })
    }
  />
)

/** 告知：只有一个「知道了」，没有取消键。 */
export const Alert = (): JSX.Element => (
  <Host
    open={() =>
      alertDialog({
        title: '导出完成',
        message: '成片已经保存到「文稿 / Nomi Projects / 海边黄昏 / 导出」。',
      })
    }
  />
)

/** 输入：替代 window.prompt，带输入框。 */
export const Prompt = (): JSX.Element => (
  <Host
    open={() =>
      promptDialog({
        title: '给这个项目改个名字',
        placeholder: '项目名称',
        initialValue: '海边黄昏',
        confirmLabel: '保存',
      })
    }
  />
)
