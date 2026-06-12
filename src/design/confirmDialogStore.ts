// confirmDialog 的指令层（与 ConfirmDialogHost 组件分文件：react-refresh 要求
// 组件文件只导出组件）。API 说明见 confirmDialog.tsx 头注释。
export type DialogKind = 'confirm' | 'alert' | 'prompt'

export type DialogRequest = {
  kind: DialogKind
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 危险动作（删除等）：确认键走警示色。 */
  danger?: boolean
  placeholder?: string
  initialValue?: string
  resolve: (value: boolean | string | null) => void
}

let dispatchRequest: ((request: DialogRequest) => void) | null = null
const preMountQueue: DialogRequest[] = []

function submit(request: DialogRequest): void {
  if (dispatchRequest) dispatchRequest(request)
  else preMountQueue.push(request)
}

/** Host 挂载时注册分发器；卸载传 null。返回挂载前积压的请求。 */
export function bindConfirmDialogHost(dispatch: ((request: DialogRequest) => void) | null): DialogRequest[] {
  dispatchRequest = dispatch
  if (!dispatch) return []
  const backlog = preMountQueue.splice(0, preMountQueue.length)
  return backlog
}

/** 确认框：resolve true=确认 / false=取消（含 ESC/点遮罩）。 */
export function confirmDialog(options: {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    submit({ kind: 'confirm', ...options, resolve: (value) => resolve(value === true) })
  })
}

/** 提示框（替代 window.alert）：仅一个「知道了」键。 */
export function alertDialog(options: { title: string; message?: string; confirmLabel?: string }): Promise<void> {
  return new Promise((resolve) => {
    submit({ kind: 'alert', ...options, resolve: () => resolve() })
  })
}

/** 输入框（替代 window.prompt）：resolve 输入串 / null=取消。 */
export function promptDialog(options: {
  title: string
  message?: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
}): Promise<string | null> {
  return new Promise((resolve) => {
    submit({
      kind: 'prompt',
      ...options,
      resolve: (value) => resolve(typeof value === 'string' ? value : null),
    })
  })
}
