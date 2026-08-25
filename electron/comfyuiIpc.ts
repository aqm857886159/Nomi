// 本地 ComfyUI 域的全部 IPC 注册（从 main.ts 拆出，给 800 行门腾空间；后续 comfy 通道加这里，别回填 main.ts）。
// 通道语义：probe / reconcile 是异步网络问询（ipcMain.handle）；analyze 纯解析、import/update 落库（同步）。
// 本文件自身被 main.ts 惰性 require（registerIpc 时才载入），内部用静态 import 即可，不再层层 require。
import { ipcMain } from "electron";
import { assertTrustedSender } from "./ipcSenderGuard";
import { probeComfyuiSystemStats } from "./comfyuiProbe";
import {
  analyzeComfyWorkflowText,
  analyzeComfyWorkflowTextSmart,
  importComfyWorkflowToCatalog,
  reconcileComfyWorkflowText,
  reconcileComfyWorkflowTexts,
  updateComfyWorkflowInCatalog,
} from "./catalog/comfyuiWorkflowImportStore";
import { fetchComfyuiTemplateDetail, fetchComfyuiTemplates } from "./comfyuiTemplates";
import { readCatalog } from "./catalog/catalogStore";
import { COMFYUI_VENDOR_KEY } from "./catalog/types";
import { listComfyuiPresets } from "./catalog/comfyuiPresets";
import { interruptComfyuiTask, unwatchComfyuiTask, watchComfyuiTask } from "./comfyuiProgressSocket";

type RegisterSyncIpc = (channel: string, handler: (...args: unknown[]) => unknown) => void;

export function registerComfyuiIpc(registerSyncIpc: RegisterSyncIpc): void {
  // 健康探测（接入卡启用/重检调用；直连 localhost /system_stats，不走系统代理）。
  ipcMain.handle("nomi:model-catalog:comfyui:probe", (event, baseUrl: unknown) => {
    assertTrustedSender(event);
    return probeComfyuiSystemStats(String(baseUrl || ""));
  });
  // 自定义 workflow 导入（S3）：analyze 同步纯解析；reconcile 异步问本机 /object_info 对账缺节点/缺模型；
  // import/update 落库为用户自有 model+mapping。
  registerSyncIpc("nomi:model-catalog:comfyui:analyze-workflow", (text: unknown) => analyzeComfyWorkflowText(text));
  // 智能分析（T1）：界面格式自动借 ComfyUI 前端转 API 再分析——用户贴什么格式都吃。
  ipcMain.handle("nomi:model-catalog:comfyui:analyze-workflow-smart", (event, text: unknown, vendorKey: unknown) => {
    assertTrustedSender(event);
    return analyzeComfyWorkflowTextSmart(text, vendorKey);
  });
  ipcMain.handle("nomi:model-catalog:comfyui:reconcile-workflow", (event, text: unknown, vendorKey: unknown) => {
    assertTrustedSender(event);
    return reconcileComfyWorkflowText(text, vendorKey);
  });
  ipcMain.handle("nomi:model-catalog:comfyui:reconcile-workflows", (event, items: unknown, vendorKey: unknown) => {
    assertTrustedSender(event);
    return reconcileComfyWorkflowTexts(items, vendorKey);
  });
  registerSyncIpc("nomi:model-catalog:comfyui:import-workflow", (payload: unknown) => importComfyWorkflowToCatalog(payload));
  registerSyncIpc("nomi:model-catalog:comfyui:update-workflow", (payload: unknown) => updateComfyWorkflowInCatalog(payload));
  // 预置模板（S5）：静态清单，启用前经 reconcile 缺件闸、启用走既有 import 链。
  registerSyncIpc("nomi:model-catalog:comfyui:presets", () => listComfyuiPresets());
  // 模板库（T2）：读**用户自己 ComfyUI 里的**官方模板（几百个），我们零维护。
  const comfyBaseUrl = (vendorKey: unknown): string => {
    const key = String(vendorKey || "").trim() || COMFYUI_VENDOR_KEY;
    return String(readCatalog().vendors.find((v) => v.key === key)?.baseUrlHint || "");
  };
  ipcMain.handle("nomi:model-catalog:comfyui:templates", (event, vendorKey: unknown) => {
    assertTrustedSender(event);
    return fetchComfyuiTemplates(comfyBaseUrl(vendorKey));
  });
  ipcMain.handle("nomi:model-catalog:comfyui:template-detail", (event, name: unknown, vendorKey: unknown) => {
    assertTrustedSender(event);
    return fetchComfyuiTemplateDetail(comfyBaseUrl(vendorKey), String(name || ""));
  });
  // ws 进度桥（P 轨）：提交后 watch 登记 prompt_id→节点，进度/预览经 nomi:tasks:comfyui:progress 推回；
  // interrupt = 遮罩取消按钮（新服定向 jobs cancel；旧服只安全删除排队项）。
  ipcMain.handle("nomi:tasks:comfyui:watch", (event, payload: unknown) => {
    assertTrustedSender(event);
    return watchComfyuiTask((payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>, event.sender.id);
  });
  ipcMain.handle("nomi:tasks:comfyui:unwatch", (event, promptId: unknown) => {
    assertTrustedSender(event);
    return unwatchComfyuiTask(promptId);
  });
  ipcMain.handle("nomi:tasks:comfyui:interrupt", (event, promptId: unknown) => {
    assertTrustedSender(event);
    return interruptComfyuiTask(promptId);
  });
}
