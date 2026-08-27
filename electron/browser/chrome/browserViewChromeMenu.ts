import { BrowserWindow } from "electron";
import path from "node:path";
import { clampNumber } from "../core/browserViewUtils";
import type { BrowserChromeMenuItem, BrowserChromeMenuItemPayload, BrowserChromeMenuPayload, BrowserChromeMenuRecord } from "../core/browserViewTypes";

const browserChromeMenusByWindow = new Map<number, BrowserChromeMenuRecord>();
const browserChromeMenusByWebContents = new Map<number, BrowserChromeMenuRecord>();

export function normalizeBrowserChromeMenuPayload(payload: BrowserChromeMenuPayload): {
  x: number;
  y: number;
  width: number;
  items: BrowserChromeMenuItem[];
} {
  const x = Math.max(0, Math.round(Number(payload?.x ?? 0)));
  const y = Math.max(0, Math.round(Number(payload?.y ?? 0)));
  const width = clampNumber(Math.round(Number(payload?.width ?? 224)), 160, 420);
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems.flatMap((raw): BrowserChromeMenuItem[] => {
    const item = raw as BrowserChromeMenuItemPayload;
    if (item?.type === "separator") return [{ type: "separator" }];
    const id = String(item?.id || "").trim();
    const label = String(item?.label || "").trim();
    const description = String(item?.description || "").trim();
    if (!id || !label) return [];
    return [
      {
        id,
        label,
        description,
        type: "normal",
        enabled: item.enabled !== false,
      },
    ];
  });
  if (!items.some((item) => item.type === "normal")) throw new Error("At least one menu item is required");
  return { x, y, width, items };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function browserChromeMenuHeight(items: BrowserChromeMenuItem[]): number {
  const contentHeight = items.reduce((total, item) => {
    if (item.type === "separator") return total + 9;
    return total + (item.description ? 64 : 38);
  }, 0);
  return Math.max(1, contentHeight + 12);
}

export function browserChromeMenuPreloadPath(moduleDir: string = __dirname): string {
  return path.join(moduleDir, "../../preload.js");
}

const BROWSER_CHROME_MENU_BEHAVIOR = `(() => {
  const api = window.nomiDesktop && window.nomiDesktop.browserChromeMenu;
  const selectFromEvent = (event) => {
    const button = event.target && event.target.closest ? event.target.closest('button[data-id]') : null;
    if (!button || button.disabled || !api) return;
    api.select(button.dataset.id || '');
  };
  document.addEventListener('pointerup', selectFromEvent);
  document.addEventListener('click', selectFromEvent);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && api) api.cancel();
  });
  const first = document.querySelector('button[data-id]:not([disabled])');
  if (first) first.focus();
})()`;

export function browserChromeMenuHtml(items: BrowserChromeMenuItem[]): string {
  const rows = items
    .map((item) => {
      if (item.type === "separator") return '<div class="separator" role="separator"></div>';
      const disabled = item.enabled ? "" : " disabled";
      const description = item.description ? `<span class="description">${escapeHtml(item.description)}</span>` : "";
      return `<button type="button" role="menuitem" data-id="${escapeHtml(item.id)}"${disabled}><span class="label">${escapeHtml(item.label)}</span>${description}</button>`;
    })
    .join("");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
    <title>Nomi Browser Chrome Menu</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; width: 100%; min-height: 100%; overflow: hidden; background: transparent; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .menu { box-sizing: border-box; width: 100%; min-height: 100%; padding: 6px; border: 1px solid rgba(255,255,255,.11); border-radius: 12px; background: rgba(31,29,25,.98); box-shadow: 0 18px 45px rgba(0,0,0,.42); }
      button { box-sizing: border-box; display: grid; width: 100%; min-height: 38px; padding: 7px 10px; border: 0; border-radius: 8px; background: transparent; color: rgba(255,255,255,.92); text-align: left; cursor: default; }
      button:hover, button:focus-visible { background: rgba(255,255,255,.08); outline: none; }
      button:disabled { color: rgba(255,255,255,.38); }
      .label { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; font-weight: 650; line-height: 18px; }
      .description { display: block; margin-top: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: rgba(255,255,255,.72); font-size: 12px; line-height: 17px; }
      .separator { height: 1px; margin: 4px 4px; background: rgba(255,255,255,.11); }
    </style>
  </head>
  <body>
    <div class="menu" role="menu" aria-label="浏览器菜单">${rows}</div>
  </body>
</html>`;
}

// 关闭菜单是两件安全性质完全不同的事，必须拆开（别再合成一个函数）：
//   ① 结算——纯 JS 状态（登记表 + resolve promise），任何时刻调都安全；
//   ② 拆窗——原生操作，在某些时刻调会崩（见下面 blur 处的注释）。
// 合在一起时，凡是想推迟拆窗的入口都只能连结算一起推迟，于是留出一段「已 blur 但仍可被
// select 结算」的窗口期。拆开后：结算永远同步做完，拆窗按入口的安全性各自决定时机。

/**
 * 结算并把菜单摘出登记表。返回 false = 这次调用不是赢家（已被别的事件结算过），
 * 调用方不得再动窗口——这就是「同一个菜单只会 resolve 一次、只会被拆一次」的唯一守卫。
 */
function settleBrowserChromeMenu(record: BrowserChromeMenuRecord, id: string | null): boolean {
  if (record.settled) return false;
  record.settled = true;
  browserChromeMenusByWindow.delete(record.ownerWindowId);
  // 用建窗时的快照 id，不读 record.window.webContents：owner 关闭那条路径是「先 destroy
  // 菜单窗、再结算」，此刻窗口已 closed，Electron 文档明说 closed 后不该再碰这个对象。
  browserChromeMenusByWebContents.delete(record.webContentsId);
  record.resolve({ id });
  return true;
}

/** 拆窗：窗口可能已被别处（owner 关闭 / 用户点叉）销毁，故每次都重判，重入即 no-op。 */
function destroyBrowserChromeMenuWindow(record: BrowserChromeMenuRecord): void {
  if (!record.window.isDestroyed()) record.window.close();
}

function closeBrowserChromeMenu(record: BrowserChromeMenuRecord, id: string | null): void {
  if (!settleBrowserChromeMenu(record, id)) return;
  destroyBrowserChromeMenuWindow(record);
}

export function showBrowserChromeMenu(
  owner: BrowserWindow,
  payload: ReturnType<typeof normalizeBrowserChromeMenuPayload>,
): Promise<{ id: string | null }> {
  return new Promise((resolve) => {
    const current = browserChromeMenusByWindow.get(owner.id);
    if (current) closeBrowserChromeMenu(current, null);
    const contentBounds = owner.getContentBounds();
    const height = browserChromeMenuHeight(payload.items);
    const menuWindow = new BrowserWindow({
      parent: owner,
      modal: false,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      title: "Nomi Browser Chrome Menu",
      x: contentBounds.x + payload.x,
      y: contentBounds.y + payload.y,
      width: payload.width,
      height,
      webPreferences: {
        preload: browserChromeMenuPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    menuWindow.setMenuBarVisibility(false);
    const record: BrowserChromeMenuRecord = {
      ownerWindowId: owner.id,
      window: menuWindow,
      webContentsId: menuWindow.webContents.id,
      settled: false,
      resolve,
    };
    browserChromeMenusByWindow.set(owner.id, record);
    browserChromeMenusByWebContents.set(record.webContentsId, record);
    // blur 是唯一「窗口在自己的原生焦点转移途中把自己拆掉」的入口，也是本文件唯一需要推迟拆窗的地方。
    // 为什么危险：这是个 parent: owner 的子窗口，blur 由原生层在焦点转移**进行中**派发；Windows 上
    // 第三方输入法（搜狗等）的候选窗是真·顶层窗口、会抢激活，能在我们没预期的时机把这个 blur 打出来，
    // 而「在焦点转移中途销毁一个带 parent 的子窗口」是已知的崩溃型写法——同 downloadAsset.ts:64
    //「别给原生对话框挂短生命周期父窗口」那条的同族根因。
    // 怎么防：结算同步做完（立刻摘出登记表，后续 blur/closed/select 一律进不来，也就不会二次拆窗），
    // 只把原生拆窗推迟一轮事件循环，让这次焦点转移在原生层先走完。
    // 用 setImmediate 不用 queueMicrotask：微任务在原生事件派发帧内就排空了，等于没推迟。
    // 注：这是防御性加固，并未确认对应任何已上报的崩溃。
    menuWindow.once("blur", () => {
      if (!settleBrowserChromeMenu(record, null)) return;
      setImmediate(() => destroyBrowserChromeMenuWindow(record));
    });
    menuWindow.once("closed", () => closeBrowserChromeMenu(record, null));
    owner.once("closed", () => {
      if (!menuWindow.isDestroyed()) menuWindow.destroy();
      closeBrowserChromeMenu(record, null);
    });
    menuWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    menuWindow.webContents.once("did-finish-load", () => {
      void menuWindow.webContents.executeJavaScript(BROWSER_CHROME_MENU_BEHAVIOR, true).catch(() => {
        closeBrowserChromeMenu(record, null);
      });
    });
    menuWindow.once("ready-to-show", () => {
      if (!menuWindow.isDestroyed()) menuWindow.show();
    });
    void menuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(browserChromeMenuHtml(payload.items))}`);
  });
}


export function selectBrowserChromeMenu(webContentsId: number, id: unknown): void {
  const record = browserChromeMenusByWebContents.get(webContentsId);
  if (record) closeBrowserChromeMenu(record, String(id || "").trim() || null);
}

export function cancelBrowserChromeMenu(webContentsId: number): void {
  const record = browserChromeMenusByWebContents.get(webContentsId);
  if (record) closeBrowserChromeMenu(record, null);
}
