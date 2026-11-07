/**
 * Global Portal layer contract.
 *
 * Portals are siblings under document.body, so React ownership does not determine which
 * surface is on top. Keep the ordered tiers here and make every global overlay consume them.
 *
 * `shellChrome` is the floor of the scale: the shell's own top bar / rail (Mantine AppShell, wired in
 * theme/nomiTheme.ts). Every other tier sits above it. A hand-written number on any `position: fixed` layer,
 * or any hand-written number >= this floor, bypasses the scale (2026-10-27: the splash wrote `z-[60]`, the
 * AppShell header kept Mantine's default 100, and the header was painted over the splash's skip button);
 * `pnpm run check:tokens` class 9 (scripts/lib/overlayZScan.mjs) enforces it. Numbers below the floor on
 * non-fixed elements are component-local stacking and are not part of the scale.
 */
export const NOMI_OVERLAY_Z_INDEX = {
  shellChrome: 100,
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

/**
 * 这个下拉/菜单是**我自己弹出来的**吗？
 *
 * 不能只用 z-index + 文档顺序去判（`isPopupAtOrAboveDialog` 那套）：两边都是
 * `NOMI_OVERLAY_Z_INDEX.popover`，于是判据落到文档顺序上，而 Mantine 的 Combobox
 * **在挂载时就把 portal 节点插进 body**（`keepMounted`），位置反而排在后开的浮层**前面**。
 * 2026-09-17 实测：`docOrderFollowing=false`，于是「点自己里面那枚下拉的选项」被判成点外面。
 *
 * 真正的判据是**从属关系**，不是层号也不是先后：浮层里有没有一个正展开着的触发器。
 * 两条都认（框架各写各的）：`aria-expanded="true"`，或 `aria-controls` 指着这张 popup 的 id。
 */
function ownsOpenPopup(surface: HTMLElement, popup: HTMLElement): boolean {
  if (surface.contains(popup)) return true
  if (surface.querySelector('[aria-expanded="true"]')) return true
  const id = popup.id
  return Boolean(id && surface.querySelector(`[aria-controls="${CSS.escape(id)}"]`))
}

/**
 * 这一下事件是落在「我自己弹出来的那一层」里吗？
 *
 * 为什么需要：下拉 / 菜单被 Portal 到 `document.body`，**DOM 上根本不在浮层里面**。
 * 于是「点外面就关」这条规则会把「点开我里面那枚下拉的选项」也算成点外面——
 * 浮层先关、`onOptionSubmit` 再也跑不到，结果就是**浮层里的选择器改不了值**
 * （2026-09-17 实测：分镜行尾 ⋯ 里的尺寸下拉，点哪个选项都没反应）。
 *
 * Escape 那条路早就有让位规则（`getSettingsEscapeOwnership().openPopup`），
 * mousedown 这条对偶路径一直没有——这里把缺的那一半补上，两条路共用同一个选择器名单。
 */
export function isInsidePopupAbove(surface: HTMLElement, target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  if (!element) return false
  const popup = element.closest<HTMLElement>(OPEN_ESCAPE_POPUP_SELECTOR)
  return popup !== null && (ownsOpenPopup(surface, popup) || isPopupAtOrAboveDialog(popup, surface))
}

/** 有没有一层「我自己弹出来的」下拉/菜单正开着——开着就该由它先吃掉 Escape。 */
export function hasOpenPopupAbove(surface: HTMLElement): boolean {
  return [...document.querySelectorAll<HTMLElement>(OPEN_ESCAPE_POPUP_SELECTOR)].some(
    (candidate) => isVisiblyOpen(candidate)
      && candidate !== surface
      && !surface.contains(candidate)
      && (ownsOpenPopup(surface, candidate) || isPopupAtOrAboveDialog(candidate, surface)),
  )
}
