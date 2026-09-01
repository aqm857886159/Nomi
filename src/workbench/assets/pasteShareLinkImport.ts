// 素材库「贴链接」流程：分享链接 → TikHub 解析无水印直链 → 落成项目视频素材。
//
// 只编排（prompt → 调 connector 桥 → 落素材 → 回报），不持有 UI 状态。失败态照三段式
// （发生什么 / 为什么 / 下一步），含「第三方抓取源可能随平台风控波动」的诚实提示。
// 语义见 docs/plan/2026-09-01-tikhub-connector-v1.md。
import type { TFunction } from 'i18next'
import { getDesktopBridge } from '../../desktop/bridge'
import type { toast as toastFn } from '../../ui/toast'
import type { TikhubImportResult, TikhubKeyStatus } from '../../desktop/bridgeConnector'

/** connector 错误 kind → i18n 键（三段式失败态的「为什么 + 下一步」）。 */
const ERROR_KIND_KEY: Record<string, string> = {
  'missing-key': 'assetLibrary.pasteLink.errMissingKey',
  auth: 'assetLibrary.pasteLink.errAuth',
  quota: 'assetLibrary.pasteLink.errQuota',
  'not-found': 'assetLibrary.pasteLink.errNotFound',
  'unsupported-platform': 'assetLibrary.pasteLink.errUnsupported',
  'no-play-url': 'assetLibrary.pasteLink.errNoPlayUrl',
  upstream: 'assetLibrary.pasteLink.errUpstream',
  'bad-response': 'assetLibrary.pasteLink.errBadResponse',
}

/** 从桥抛出的错误里取 connector kind（主进程 TikhubConnectorError 的 kind 会随序列化过来）。 */
function errorKindOf(error: unknown): string | null {
  if (error && typeof error === 'object') {
    const kind = (error as { kind?: unknown }).kind
    if (typeof kind === 'string' && kind in ERROR_KIND_KEY) return kind
    // Electron 会把主进程 Error 序列化成带前缀的 message；兜底从 message 里嗅 kind。
    const message = String((error as { message?: unknown }).message || '')
    for (const kind of Object.keys(ERROR_KIND_KEY)) {
      if (message.includes(kind)) return kind
    }
  }
  return null
}

/** 把任意错误翻成一句人话（带三段式的「为什么 + 下一步」）。 */
export function describeShareLinkError(error: unknown, t: TFunction): string {
  const kind = errorKindOf(error)
  if (kind) return t(ERROR_KIND_KEY[kind])
  return t('assetLibrary.pasteLink.errBadResponse')
}

export type PasteShareLinkDeps = {
  /** 弹输入框拿分享链接（返回 null = 用户取消）。 */
  prompt: (options: { title: string; message?: string; placeholder?: string; confirmLabel?: string }) => Promise<string | null>
  /** 复用全局 toast（ToastType 单一 owner 在 src/ui/toast.tsx，不另立词表）。 */
  toast: typeof toastFn
  t: TFunction
  /** 落素材成功后回流刷新 + 选中。 */
  onImported: (result: TikhubImportResult) => void
  /** 引导去设置配 key（没配 key 时）。 */
  onNeedKey: () => void
}

/**
 * 跑一次「贴链接 → 落素材」。projectId 为空（全项目视图）时先提示。
 * 没配 TikHub key 时先引导去设置，不弹链接输入（少一步空跑）。
 */
export async function runPasteShareLinkImport(projectId: string | null, deps: PasteShareLinkDeps): Promise<void> {
  const { t, toast } = deps
  const bridge = getDesktopBridge()
  if (!projectId || !bridge?.connector?.tikhub) {
    toast(t('assetLibrary.pasteLink.needProject'), 'warning')
    return
  }

  // 先看 key 配没配：没配就引导去设置，别让用户贴完链接才发现要配 key。
  let keyStatus: TikhubKeyStatus['status'] = 'missing'
  try {
    keyStatus = ((await bridge.connector.tikhub.keyStatus()) as TikhubKeyStatus).status
  } catch {
    /* 读态失败按未配置处理 */
  }
  if (keyStatus !== 'ok') {
    toast(t('assetLibrary.pasteLink.errMissingKey'), 'warning')
    deps.onNeedKey()
    return
  }

  const shareUrl = await deps.prompt({
    title: t('assetLibrary.pasteLink.title'),
    message: t('assetLibrary.pasteLink.message'),
    placeholder: t('assetLibrary.pasteLink.placeholder'),
    confirmLabel: t('assetLibrary.pasteLink.confirm'),
  })
  if (!shareUrl || !shareUrl.trim()) return

  toast(t('assetLibrary.pasteLink.resolving'), 'info')
  try {
    const result = (await bridge.connector.tikhub.importToProject({
      projectId,
      shareUrl: shareUrl.trim(),
    })) as TikhubImportResult
    deps.onImported(result)
    toast(t('assetLibrary.pasteLink.done'), 'success')
  } catch (error) {
    toast(describeShareLinkError(error, t), 'error')
  }
}
