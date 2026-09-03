// 渲染层画布事件 → 单写者日志仓库(harness S5-a)。
// 渲染层只缓冲与投递;seq/ts/redact/截断/分段全部在 appendEvents 单点完成(§1.2 写路径唯一)。
import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import { appendEvents, readEvents } from "./eventLogRepository";
import type { NewNomiEvent } from "./types";
import { deriveGenerationEtaStats } from './generationEtaStats';

export function registerEventsIpc(): void {
  ipcMain.handle("nomi:events:append", async (event, payload: { projectId?: string; events?: unknown }) => {
    assertTrustedSender(event);
    const projectId = String(payload?.projectId || "");
    const events = Array.isArray(payload?.events) ? (payload.events as NewNomiEvent[]) : [];
    const written = appendEvents(projectId, events);
    // lastSeq 回传:渲染层据此维护 lastAppliedSeq(写进项目快照,hydrate 时重放 seq 之后的尾巴)
    return { ok: true, count: written.length, lastSeq: written.length ? written[written.length - 1].seq : 0 };
  });

  // S5-b-1:hydrate 尾部重放 + 轨迹查看的读口(sidecar 已在仓库层还原)
  ipcMain.handle("nomi:events:read", async (event, payload: { projectId?: string; fromSeq?: number }) => {
    assertTrustedSender(event);
    const projectId = String(payload?.projectId || "");
    const fromSeq = Number(payload?.fromSeq) || 0;
    return { ok: true, events: readEvents(projectId, { fromSeq }) };
  });

  // ETA 读口只回按 vendor/model/kind 聚合后的数字，不把原始提示词或 URL 带进 renderer。
  ipcMain.on('nomi:events:generation-eta-stats', (event, payload: { projectId?: string }) => {
    assertTrustedSender(event);
    const projectId = String(payload?.projectId || '');
    event.returnValue = { ok: true, stats: deriveGenerationEtaStats(readEvents(projectId)) };
  });
}
