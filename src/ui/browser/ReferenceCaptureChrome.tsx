import React from 'react'
import { IconArrowLeft, IconArrowRight, IconCamera, IconExternalLink, IconRefresh } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { normalizeBrowserInput } from './browserUrl'

// 参考捕捞窗的 chrome（#/reference-capture 路由，独立 BrowserWindow 里跑）：固定 48px 工具条，
// 下方区域由主进程把 WebContentsView 铺满（TOOLBAR_HEIGHT 约定，见 referenceCaptureWindow.ts）。
// 职责只有工具条 UI + IPC 转发；页面内容/捕捞逻辑全在主进程（这里碰不到不可信内容）。

type ChromeState = {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type CaptureToast = { ok: boolean; text: string } | null

const NAV_BUTTON = cn(
  'w-8 h-8 grid place-items-center rounded-nomi-sm cursor-pointer border-0 bg-transparent shrink-0',
  'text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05',
  'transition-[background,color] duration-[var(--nomi-transition-fast)]',
  'disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-nomi-ink-40',
)

export default function ReferenceCaptureChrome(): JSX.Element {
  const bridge = getDesktopBridge()
  const [state, setState] = React.useState<ChromeState | null>(null)
  const [input, setInput] = React.useState('')
  const [editing, setEditing] = React.useState(false)
  const [captureToast, setCaptureToast] = React.useState<CaptureToast>(null)

  // 本路由跑在独立捕捞窗里：窗口标题跟随身份（renderer 的 <title>Nomi</title> 会盖掉主进程设的标题）。
  React.useEffect(() => {
    document.title = '网页捕捞 — Nomi'
  }, [])

  React.useEffect(() => {
    if (!bridge?.browserCapture) return
    const offState = bridge.browserCapture.onState((next) => setState(next))
    const offDone = bridge.browserCapture.onCaptureDone((payload) => {
      setCaptureToast(payload.ok
        ? { ok: true, text: `已捕捞进素材库：${payload.name || ''}` }
        : { ok: false, text: payload.error || '捕捞失败' })
    })
    void bridge.browserCapture.requestState()
    return () => { offState(); offDone() }
  }, [bridge])

  // 地址栏未在编辑时跟随页面真实 URL（导航/重定向后回显）。
  React.useEffect(() => {
    if (!editing && state) setInput(state.url)
  }, [state, editing])

  // 捕捞提示 3s 自动消隐。
  React.useEffect(() => {
    if (!captureToast) return
    const timer = setTimeout(() => setCaptureToast(null), 3000)
    return () => clearTimeout(timer)
  }, [captureToast])

  const navigate = () => {
    const url = normalizeBrowserInput(input)
    setEditing(false)
    void bridge?.browserCapture?.navigate({ url })
  }

  return (
    <div className={cn('flex h-12 items-center gap-1.5 px-3 border-b border-nomi-line bg-nomi-bg')}>
      <button type="button" className={NAV_BUTTON} aria-label="后退" disabled={!state?.canGoBack} onClick={() => void bridge?.browserCapture?.back()}>
        <IconArrowLeft size={16} stroke={2} />
      </button>
      <button type="button" className={NAV_BUTTON} aria-label="前进" disabled={!state?.canGoForward} onClick={() => void bridge?.browserCapture?.forward()}>
        <IconArrowRight size={16} stroke={2} />
      </button>
      <button type="button" className={NAV_BUTTON} aria-label="刷新" onClick={() => void bridge?.browserCapture?.reload()}>
        <IconRefresh size={16} stroke={2} className={state?.loading ? 'animate-spin' : undefined} />
      </button>
      <input
        className={cn(
          'h-8 min-w-0 flex-1 rounded-full border border-nomi-line bg-nomi-paper px-3.5',
          'text-body-sm text-nomi-ink outline-none',
          'focus:border-nomi-ink-40 transition-[border-color] duration-[var(--nomi-transition-fast)]',
        )}
        value={input}
        placeholder="输入网址或搜索——右键网页图片即可捕捞进素材库"
        aria-label="地址栏"
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') navigate() }}
      />
      {captureToast ? (
        <span className={cn('shrink-0 max-w-[240px] truncate text-caption', captureToast.ok ? 'text-nomi-ink-60' : 'text-nomi-danger')}>
          {captureToast.text}
        </span>
      ) : null}
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-full cursor-pointer shrink-0',
          'bg-nomi-ink text-nomi-paper text-caption font-semibold border-0',
          'transition-[background] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-80',
        )}
        aria-label="截图捕捞整页"
        onClick={() => void bridge?.browserCapture?.screenshot()}
      >
        <IconCamera size={14} stroke={2} />
        截图捕捞
      </button>
      <button type="button" className={NAV_BUTTON} aria-label="在系统浏览器打开" title="在系统浏览器打开" onClick={() => void bridge?.browserCapture?.openExternal()}>
        <IconExternalLink size={16} stroke={2} />
      </button>
    </div>
  )
}
