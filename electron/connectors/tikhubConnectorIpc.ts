// TikHub connector 的 IPC 注册收口（照 registerVideoIpc 同款外置模式）。
//
// 全部 handler 先过 assertTrustedSender（R20 IPC 来源绑定：主窗口专用通道）。
// 重活模块（凭据 / 出站 / 拆解链路）用动态 import()，避免加载期把 catalog/ffmpeg 拉进启动路径。
import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";

export function registerTikhubConnectorIpc(): void {
  ipcMain.handle("nomi:connector:tikhub:key-status", async (event) => {
    assertTrustedSender(event);
    const { getTikhubKeyStatus } = await import("./tikhubConnectorService");
    return getTikhubKeyStatus();
  });
  ipcMain.handle("nomi:connector:tikhub:save-key", async (event, payload) => {
    assertTrustedSender(event);
    const { saveTikhubApiKey } = await import("./tikhubConnectorService");
    return saveTikhubApiKey(payload);
  });
  ipcMain.handle("nomi:connector:tikhub:clear-key", async (event) => {
    assertTrustedSender(event);
    const { clearTikhubApiKey } = await import("./tikhubConnectorService");
    return clearTikhubApiKey();
  });
  // 线路状态（高级设置「线路」行）：当前 mode + 生效域 + 候选域。永不触网。
  ipcMain.handle("nomi:connector:tikhub:route-status", async (event) => {
    assertTrustedSender(event);
    const { getTikhubRoute } = await import("./tikhubConnectorService");
    return getTikhubRoute();
  });
  // 手动指定线路（auto / 强制 io / 强制 dev）。
  ipcMain.handle("nomi:connector:tikhub:set-route", async (event, payload) => {
    assertTrustedSender(event);
    const { setTikhubRoute } = await import("./tikhubConnectorService");
    return setTikhubRoute(payload);
  });
  // 只解析（不落盘）——供 UI 在落素材/拆解前展示费用确认。
  ipcMain.handle("nomi:connector:tikhub:resolve-share-url", async (event, payload) => {
    assertTrustedSender(event);
    const { resolveTikhubShareUrl } = await import("./tikhubConnectorService");
    return resolveTikhubShareUrl(payload);
  });
  // 解析 + 落成项目视频素材（带 AssetSourceEvidence）。
  ipcMain.handle("nomi:connector:tikhub:import-to-project", async (event, payload) => {
    assertTrustedSender(event);
    const { importTikhubShareUrl } = await import("./tikhubConnectorService");
    return importTikhubShareUrl(payload);
  });
}
