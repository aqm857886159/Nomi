// 取回阶段的错误出口（从 taskResultQuery.ts 原样搬来，2026-10-28）：异步取回（查询 / 读结果 / 下载）和结果落地门
// （assets/localizeTaskAsset.ts）共用这一个函数挂取回阶段码。搬家只为让落地门能用它而不依赖运行时
// （taskResultQuery 从 runtime 取执行器，runtime 又引落地门）；函数体一字未改，两个依赖改从定义处直接引同一个符号。
import { desktopT } from "../desktopStrings";
import { NOMI_ERROR_ONLY_BEFORE_SUBMIT, matchNomiErrorCode, tagNomiError } from "../shared/nomiErrorCodes";
import { VendorRequestError } from "../shared/vendorFailure";

/**
 * 取回失败的统一出口：带上阶段码（shared/nomiErrorCodes 的 retrieval-*）与阶段说明。已经带码、且码说的是
 * 取回阶段的错误（出站被拦 / 产物读不出……）原样放行——那是更具体的事实。VendorRequestError 保留结构化字段
 * （IPC 那头靠它说出「服务商原话」）。渲染层见码即落「可找回」：任务已受理，重新取回，绝不重新提交。
 *
 * 码的话只在「提交之前」成立（NOMI_ERROR_ONLY_BEFORE_SUBMIT：没发出去 / 没请求服务商 / 可以重新生成）：生产者被提交和
 * 查询共用、不知道这是查询（vendorHttp 出站守卫一律按提交挂码），这里改挂本阶段码。原码和诊断前缀留进正文
 * （技术详情），标明是 Nomi 本机拦下；那句提交前的话不带（任务已提交，它是假话），也不把它当服务商原话（不带 structured）。
 */
export function retrievalStageError(code: "retrieval-query" | "retrieval-parse" | "retrieval-download", error: unknown, note = ""): Error {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const carried = matchNomiErrorCode(message);
  if (carried && !NOMI_ERROR_ONLY_BEFORE_SUBMIT[carried]) return error instanceof Error ? error : new Error(message);
  const stageKey = code === "retrieval-query" ? "tasks.retrievalStage.query" : code === "retrieval-parse" ? "tasks.retrievalStage.parse" : "tasks.retrievalStage.download";
  if (carried) {
    const marker = message.indexOf("NOMI_ERR::");
    const diagnostic = marker > 0 ? message.slice(0, marker).replace(/[:：\s]+$/, "").trim() : "";
    return new Error(tagNomiError(code, `${note ? `${note} ` : ""}${desktopT(stageKey)}${desktopT("tasks.refusedLocallyAfterSubmit", { code: carried })}${diagnostic ? ` ${diagnostic}` : ""}`));
  }
  const human = `${note ? `${note} ` : ""}${desktopT(stageKey)}${message}`;
  const tagged = tagNomiError(code, human);
  // 只带 message + structured（IPC 那头读 structured 说出服务商原话）：providerAnswer 只服务「提交有没有被受理」的判定，
  // 查询 / 下载阶段用不上；两参构造也让这段能原样回补到 0.23.x（那里的 VendorRequestError 只有两参）。
  return error instanceof VendorRequestError ? new VendorRequestError(tagged, error.structured) : new Error(tagged);
}
