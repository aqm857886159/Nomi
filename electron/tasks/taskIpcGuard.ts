import { ApimartGenerationProviderError } from "../capabilityCore/apimartGenerationErrors";
// S4-2:VendorRequestError 的 structured 经 base64 标记穿 IPC(rejection 只剩 message 字符串);
// 顺带补「创建即失败」的 vendor.call.completed(failed) 事件(成功/轮询终态在 runtime 内记)。
export async function runTaskIpcGuard<T>(payload: unknown, thunk: () => Promise<T>): Promise<T> {
  try {
    return await thunk();
  } catch (error) {
    const { VendorRequestError, encodeVendorErrorMessage } = await import("../vendor/vendorHttp");
    // The catalog adapter adds call context around the same request. Other wrappers
    // describe a separate outcome (for example, an unconfirmed submission).
    const vendorError = error instanceof ApimartGenerationProviderError ? error.cause : error;
    if (vendorError instanceof VendorRequestError) {
      const { traceVendorCompleted } = await import("../events/vendorCallTrace");
      const extras = (payload as { request?: { extras?: Record<string, unknown> } })?.request?.extras || {};
      traceVendorCompleted(String(extras.projectId || ""), {
        runId: `failed-${Math.random().toString(36).slice(2, 10)}`,
        ...(extras.nodeId ? { nodeId: String(extras.nodeId) } : {}),
        status: "failed",
        assetCount: 0,
        error: vendorError.structured,
      });
      throw new Error(encodeVendorErrorMessage(vendorError), { cause: error });
    }
    const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code : undefined;
    const reason = error && typeof error === "object" && typeof (error as { reason?: unknown }).reason === "string"
      ? (error as { reason: string }).reason : undefined;
    if (code && reason) {
      const { encodeStructuredErrorMessage } = await import("../vendor/vendorHttp");
      throw new Error(encodeStructuredErrorMessage({ code, reason }, error instanceof Error ? error.message : String(error)), { cause: error });
    }
    throw error;
  }
}
