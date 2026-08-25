// 全局截图热键的 IPC 注册（main.ts 已顶到 800 行上限，新增 IPC 一律外挂成 registrar）。
import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";

export function registerScreenshotIpc(): void {
  ipcMain.handle("nomi:screenshot:get", async (event) => {
    assertTrustedSender(event);
    const { readScreenshotHotkeyPrefs, screenAccessStatus, isScreenshotHotkeyRegistered } = await import("./screenshotHotkey");
    const prefs = readScreenshotHotkeyPrefs();
    // 只读查询不该有副作用（别在这儿重装热键）；registered 用「当前是否真注册着」回答。
    return { ...prefs, registered: isScreenshotHotkeyRegistered(prefs.accelerator), screenAccess: screenAccessStatus() };
  });

  ipcMain.handle("nomi:screenshot:set", async (event, payload) => {
    assertTrustedSender(event);
    const { applyScreenshotHotkey, writeScreenshotHotkeyPrefs } = await import("./screenshotHotkey");
    // 落盘 + 立刻生效（改完不用重启）。返回的 registered 会告诉 UI 这组键有没有被别的应用占掉。
    return applyScreenshotHotkey(writeScreenshotHotkeyPrefs(payload));
  });

  ipcMain.handle("nomi:screenshot:open-permission-settings", async (event) => {
    assertTrustedSender(event);
    const { openScreenRecordingSettings } = await import("./screenshotHotkey");
    await openScreenRecordingSettings();
    return { ok: true };
  });

  // E2E 专用：全局热键是 OS 级按键，Playwright 发不出去（它只能往窗口里发键）。
  // 走查要验的是热键**回调之后**那整条链（抓屏 → 落素材 → 弹选区 → 落节点），
  // 所以给它一个只在 NOMI_E2E=1 时存在的入口去调同一个函数——不是另写一条测试专用逻辑。
  // 与仓里既有的 E2E 后门同一套门禁（见 __nomiQueueStore 只在 localStorage.__nomiE2E==='1' 暴露）。
  if (process.env.NOMI_E2E === "1") {
    ipcMain.handle("nomi:screenshot:e2e-capture", async (event) => {
      assertTrustedSender(event);
      const { captureScreenToCanvas } = await import("./screenshotHotkey");
      await captureScreenToCanvas();
      return { ok: true };
    });
  }

  ipcMain.handle("nomi:screenshot:set-project", async (event, payload) => {
    assertTrustedSender(event);
    const { setScreenshotProjectId } = await import("./screenshotHotkey");
    const projectId = typeof payload === "string" ? payload : String((payload as { projectId?: string })?.projectId || "");
    setScreenshotProjectId(projectId);
    return { ok: true };
  });
}
