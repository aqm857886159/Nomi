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

function browserChromeMenuHtml(items: BrowserChromeMenuItem[]): string {
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
    <script>
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
    </script>
  </body>
</html>`;
}

function closeBrowserChromeMenu(record: BrowserChromeMenuRecord, id: string | null): void {
  if (record.settled) return;
  record.settled = true;
  browserChromeMenusByWindow.delete(record.ownerWindowId);
  browserChromeMenusByWebContents.delete(record.window.webContents.id);
  record.resolve({ id });
  if (!record.window.isDestroyed()) record.window.close();
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
        preload: path.join(__dirname, "../preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    menuWindow.setMenuBarVisibility(false);
    const record: BrowserChromeMenuRecord = {
      ownerWindowId: owner.id,
      window: menuWindow,
      settled: false,
      resolve,
    };
    browserChromeMenusByWindow.set(owner.id, record);
    browserChromeMenusByWebContents.set(menuWindow.webContents.id, record);
    menuWindow.once("blur", () => closeBrowserChromeMenu(record, null));
    menuWindow.once("closed", () => closeBrowserChromeMenu(record, null));
    owner.once("closed", () => {
      if (!menuWindow.isDestroyed()) menuWindow.destroy();
      closeBrowserChromeMenu(record, null);
    });
    menuWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
