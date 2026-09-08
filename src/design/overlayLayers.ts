/**
 * Global Portal layer contract.
 *
 * Portals are siblings under document.body, so React ownership does not determine which
 * surface is on top. Keep the ordered tiers here and make every global overlay consume them.
 */
export const NOMI_OVERLAY_Z_INDEX = {
  floatingPanel: 4000,
  applicationModal: 9000,
  dialog: 9100,
  popover: 9200,
  confirmation: 9300,
  feedback: 2147483647,
} as const

export type NomiOverlayLayer = keyof typeof NOMI_OVERLAY_Z_INDEX

/** camelCase 层名 → kebab（`applicationModal` → `application-modal`）。CSS 变量名与 Tailwind 类名共用。 */
function overlayLayerToken(layer: NomiOverlayLayer): string {
  return layer.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
}

export function overlayZIndexCssVar(layer: NomiOverlayLayer): string {
  return `--nomi-z-${overlayLayerToken(layer)}`
}

/**
 * `:root` 上的镜像（由 tailwind.config.ts 的 addBase 注入）。
 *
 * 为什么要它：Tailwind 默认 `zIndex` 刻度只到 50，而本仓的层级契约是 4000–9300，
 * className 侧**没有合法出口**——于是画布里五处浮层只能硬写 `z-[9999]`/`z-[10000]`，
 * 结果全部压过 `dialog: 9100` 的花钱确认卡（2026-09-07 实测）。这不是懒，是没得选。
 * 数字仍只有 `NOMI_OVERLAY_Z_INDEX` 一份，CSS 变量与 Tailwind 刻度都从它派生（禁止两处各写一遍）。
 */
export const NOMI_OVERLAY_Z_INDEX_CSS_VARS: Record<string, string> = Object.fromEntries(
  (Object.keys(NOMI_OVERLAY_Z_INDEX) as NomiOverlayLayer[]).map((layer) => [
    overlayZIndexCssVar(layer),
    String(NOMI_OVERLAY_Z_INDEX[layer]),
  ]),
)

/** Tailwind `theme.extend.zIndex`：`z-dialog` / `z-confirmation` / `z-floating-panel` … */
export const NOMI_OVERLAY_Z_INDEX_TAILWIND_SCALE: Record<string, string> = Object.fromEntries(
  (Object.keys(NOMI_OVERLAY_Z_INDEX) as NomiOverlayLayer[]).map((layer) => [
    overlayLayerToken(layer),
    `var(${overlayZIndexCssVar(layer)})`,
  ]),
)

function highestLayerZIndex(element: Element): number {
  let current: Element | null = element
  let highest = 0
  while (current) {
    const value = Number.parseInt(window.getComputedStyle(current).zIndex || '0', 10)
    if (Number.isFinite(value)) highest = Math.max(highest, value)
    current = current.parentElement
  }
  return highest
}

const OPEN_ESCAPE_POPUP_SELECTOR = [
  '[role="listbox"]',
  '[role="menu"]',
  '[data-nomi-escape-layer="true"]',
].join(', ')

const ESCAPE_OWNING_TARGET_SELECTOR = [
  '[data-mantine-stop-propagation="true"]',
  '[data-nomi-escape-owner="true"]',
].join(', ')

export type SettingsEscapeOwnership = {
  dialogAbove: boolean
  openPopup: boolean
  targetOwnsEscape: boolean
  targetWasRemoved: boolean
}

export function shouldYieldSettingsEscape(ownership: SettingsEscapeOwnership): boolean {
  return ownership.dialogAbove || ownership.openPopup || ownership.targetOwnsEscape || ownership.targetWasRemoved
}

function isVisiblyOpen(element: HTMLElement): boolean {
  if (element.hidden || element.getClientRects().length === 0) return false
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function isPopupAtOrAboveDialog(candidate: HTMLElement, dialog: HTMLElement): boolean {
  if (dialog.contains(candidate)) return true
  const candidateLayer = highestLayerZIndex(candidate)
  const ownLayer = highestLayerZIndex(dialog)
  if (candidateLayer !== ownLayer) return candidateLayer > ownLayer
  return Boolean(dialog.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
}

/** Settings owns Escape only when no later Portal dialog is visually above it. */
export function hasOpenDialogAbove(dialog: HTMLElement): boolean {
  const ownLayer = highestLayerZIndex(dialog)
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some((candidate) => {
    if (candidate === dialog || candidate.getClientRects().length === 0) return false
    const candidateLayer = highestLayerZIndex(candidate)
    if (candidateLayer !== ownLayer) return candidateLayer > ownLayer
    return Boolean(dialog.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
}

/**
 * Snapshot the owner before React/Mantine handles Escape. Popup state can disappear
 * synchronously during the target handler, so Settings must not decide from the later DOM.
 */
export function getSettingsEscapeOwnership(
  dialog: HTMLElement,
  target: EventTarget | null,
  targetWasRemoved = false,
): SettingsEscapeOwnership {
  const targetElement = target instanceof Element ? target : null
  return {
    dialogAbove: hasOpenDialogAbove(dialog),
    targetOwnsEscape: Boolean(targetElement?.closest(ESCAPE_OWNING_TARGET_SELECTOR)),
    openPopup: [...document.querySelectorAll<HTMLElement>(OPEN_ESCAPE_POPUP_SELECTOR)].some(
      (candidate) => isVisiblyOpen(candidate) && isPopupAtOrAboveDialog(candidate, dialog),
    ),
    targetWasRemoved,
  }
}

export function settingsEscapeTargetWasRemoved(target: EventTarget | null): boolean {
  return target instanceof Node && !target.isConnected
}
