// 提示词截图的页面内拖拽选区（从 browserViewMedia 拆出，防巨壳 R9）：
// 注入遮罩 + 拖框 + Esc 取消，返回页面本地矩形。行为与原内联实现等价。
import { BrowserWindow } from "electron";
import { bringBrowserViewToFront } from "../core/browserViewUtils";
import type { BrowserPromptScreenshotSelectionResult, BrowserResourceCaptureRectPayload, BrowserViewRecord } from "../core/browserViewTypes";
import { normalizeLocalCaptureRect } from "./browserCaptureSource";

export async function selectBrowserPromptScreenshotRect(record: BrowserViewRecord): Promise<BrowserPromptScreenshotSelectionResult> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) return { ok: false, reason: "error", message: "Browser view is unavailable" };
  const owner = BrowserWindow.fromId(record.ownerWindowId);
  if (!owner || owner.isDestroyed()) return { ok: false, reason: "error", message: "Browser window is unavailable" };
  if (record.lastBounds.width <= 0 || record.lastBounds.height <= 0) {
    return { ok: false, reason: "error", message: "Browser view bounds are unavailable" };
  }
  try {
    bringBrowserViewToFront(record);
    record.view.setBounds(record.lastBounds);
    record.view.setVisible(true);
    contents.focus();
  } catch {
    // Focusing can fail while the view is navigating; executeJavaScript below will surface real failures.
  }
  const script = `
(() => new Promise((resolve) => {
  const existing = document.getElementById('__nomi_prompt_screenshot_selection__');
  if (existing && existing.parentElement) existing.parentElement.removeChild(existing);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const viewport = () => ({
    width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
    height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1),
  });
  const pointFromEvent = (event) => {
    const bounds = viewport();
    return {
      x: clamp(event.clientX, 0, bounds.width),
      y: clamp(event.clientY, 0, bounds.height),
    };
  };
  const rectFromPoints = (start, end) => {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x);
    const bottom = Math.max(start.y, end.y);
    return { left, top, width: right - left, height: bottom - top };
  };

  const overlay = document.createElement('div');
  overlay.id = '__nomi_prompt_screenshot_selection__';
  overlay.tabIndex = -1;
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'cursor:crosshair',
    'background:rgba(0,0,0,.42)',
    'outline:none',
    'user-select:none',
    'touch-action:none',
    'pointer-events:auto'
  ].join(';');

  const hint = document.createElement('div');
  hint.textContent = '拖拽选择截图区域，Esc 取消';
  hint.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:18px',
    'transform:translateX(-50%)',
    'height:32px',
    'display:flex',
    'align-items:center',
    'padding:0 12px',
    'border-radius:999px',
    'background:rgba(17,24,39,.88)',
    'color:#fff',
    'font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'box-shadow:0 10px 24px rgba(15,23,42,.24)',
    'pointer-events:none'
  ].join(';');

  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed',
    'display:none',
    'border:2px solid #fff',
    'border-radius:10px',
    'background:rgba(255,255,255,.08)',
    'box-shadow:0 0 0 9999px rgba(0,0,0,.34),0 12px 32px rgba(0,0,0,.28)',
    'pointer-events:none'
  ].join(';');

  const sizeLabel = document.createElement('div');
  sizeLabel.style.cssText = [
    'position:absolute',
    'right:8px',
    'bottom:8px',
    'height:22px',
    'display:flex',
    'align-items:center',
    'padding:0 7px',
    'border-radius:999px',
    'background:rgba(17,24,39,.82)',
    'color:#fff',
    'font:600 11px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
  ].join(';');
  box.appendChild(sizeLabel);
  (document.body || document.documentElement).appendChild(overlay);
  overlay.appendChild(hint);
  overlay.appendChild(box);

  let start = null;
  let settled = false;

  const render = (rect) => {
    box.style.display = 'block';
    box.style.left = Math.round(rect.left) + 'px';
    box.style.top = Math.round(rect.top) + 'px';
    box.style.width = Math.round(rect.width) + 'px';
    box.style.height = Math.round(rect.height) + 'px';
    sizeLabel.textContent = Math.round(rect.width) + ' x ' + Math.round(rect.height);
  };
  const cleanup = () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('keydown', onKeyDown, true);
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  };
  const finish = (rect) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(rect);
  };
  function onPointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      finish(null);
      return;
    }
    start = pointFromEvent(event);
    render({ left: start.x, top: start.y, width: 0, height: 0 });
  }
  function onPointerMove(event) {
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    render(rectFromPoints(start, pointFromEvent(event)));
  }
  function onPointerUp(event) {
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = rectFromPoints(start, pointFromEvent(event));
    finish(rect.width >= 8 && rect.height >= 8 ? rect : null);
  }
  function onCancel(event) {
    event.preventDefault();
    event.stopPropagation();
    finish(null);
  }
  function onContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    finish(null);
  }
  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish(null);
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('keydown', onKeyDown, true);
  try { overlay.focus({ preventScroll: true }); } catch {}
}))()
`;
  try {
    const selected = (await contents.executeJavaScript(script, true)) as BrowserResourceCaptureRectPayload | null;
    const rect = normalizeLocalCaptureRect(record, selected ?? undefined);
    if (!rect) return { ok: false, reason: "cancelled" };
    return {
      ok: true,
      rect: {
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (!owner.isDestroyed()) owner.focus();
  }
}
