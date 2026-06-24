// 进程型 transport 执行器（P4 声明驱动）：当 mapping 的 op 声明了 `process`（本地 CLI 二进制，
// 如即梦官方 dreamina）时，runtime.executeProfileOperation 顶部分流到这里——而不是发 HTTP。
// 职责：渲染参数（与 HTTP body 同一套 renderTemplateValue）→ spawn → 用 op.process.parser 选的解码器把
// stdout 归一成「类 HTTP 响应」对象 → 喂回现有 buildProfileTaskResult/statusMapping（状态机/缓存/资产落盘零改）。
//
// writeAsset 由 runtime 注入（避免 processOperation ↔ runtime 循环依赖）；本地下载文件经它导入项目素材。

import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HttpOperation } from "./types";
import { runDreaminaCli, resolveDreaminaBin } from "./dreaminaCli";
import { normalizeDreaminaOutput } from "./dreaminaCodec";
import { renderTemplateValue } from "../ai/requestPipeline";
import { contentTypeFromPath } from "../assets/assetPaths";
import type { JsonRecord } from "../jsonUtils";

/** runtime 注入的写资产原语（写本地字节进项目素材，返回含 data.url 的记录）。 */
export type WriteAsset = (projectId: string, bytes: Buffer, fileName: string, contentType: string, meta: JsonRecord) => unknown;

export type ProcessOperationInput = {
  process: NonNullable<HttpOperation["process"]>;
  /** 与 HTTP body 同源的模板 context（{{request.prompt}}/{{request.params.X}}/{{providerMeta.task_id}}）。 */
  context: JsonRecord;
  /** 项目 id：用于把 `--download_dir` 下载到的本地结果导入素材；空则仅取远端 URL。 */
  projectId: string;
  writeAsset: WriteAsset;
  timeoutMs?: number;
};

/** 归一后的「类 HTTP 响应」形状。response_mapping/statusMapping 据此读取（见 dreaminaVideos.ts）。 */
export type ProcessResponse = {
  submit_id: string;
  gen_status: string;
  fail_reason: string;
  queue_info: unknown;
  /** 结果媒体：远端 http(s) URL + 本地下载文件导入后的 nomi-local:// URL。 */
  video_url: string[];
  _stdout: string;
  _stderr: string;
};

export async function executeProcessOperation(input: ProcessOperationInput): Promise<{ response: unknown; request: unknown }> {
  const bin = resolveDreaminaBin();
  if (!bin) {
    throw new Error("未找到即梦 CLI（dreamina）。请在「模型设置 · 即梦会员」卡里一键安装，或终端运行 curl -fsSL https://jimeng.jianying.com/cli | bash。");
  }

  // 渲染参数（与 HTTP body 同一套 renderTemplateValue）；空值参数（`--flag=`）丢弃 → dreamina 回落该项默认。
  const args = input.process.args
    .map((arg) => String(renderTemplateValue(arg, input.context) ?? ""))
    .filter((arg) => arg && !/=$/.test(arg));

  let downloadDir = "";
  if (input.process.appendDownloadDir) {
    downloadDir = mkdtempSync(path.join(os.tmpdir(), "nomi-dreamina-"));
    args.push(`--download_dir=${downloadDir}`);
  }

  try {
    const ran = await runDreaminaCli(args, { timeoutMs: input.timeoutMs ?? 300_000, bin });
    const normalized = normalizeDreaminaOutput(ran.stdout, ran.stderr);

    // 退出码非 0 且连 submit_id/gen_status 都解析不到 = 真·调用失败（未装/无 maestro vip 权限/参数非法）。
    // 抛清晰错误让用户看到（如「current account is not maestro vip」），而非吞成空结果。
    if (ran.code !== 0 && !normalized.submitId && !normalized.genStatus) {
      const message = (ran.stderr || ran.stdout || `exit=${ran.code}`).trim();
      throw new Error(`即梦 CLI 调用失败：${message.slice(0, 600)}`);
    }

    // 本地下载文件导入项目素材 → nomi-local://；远端 URL 直接交给现有 buildProfileTaskResult 下载。
    const localUrls: string[] = [];
    if (input.projectId) {
      for (const p of normalized.localPaths) {
        if (!existsSync(p)) continue;
        try {
          const written = input.writeAsset(input.projectId, readFileSync(p), path.basename(p), contentTypeFromPath(p), { kind: "generated" }) as { data?: { url?: string } };
          const url = String(written.data?.url || "");
          if (url && !localUrls.includes(url)) localUrls.push(url);
        } catch {
          /* 单个文件导入失败不阻断其余结果 */
        }
      }
    }

    const response: ProcessResponse = {
      submit_id: normalized.submitId,
      gen_status: normalized.genStatus,
      fail_reason: normalized.failReason,
      queue_info: normalized.queueInfo,
      video_url: Array.from(new Set([...normalized.remoteUrls, ...localUrls])),
      _stdout: ran.stdout,
      _stderr: ran.stderr,
    };
    return { response, request: { bin: path.basename(bin), args } };
  } finally {
    if (downloadDir) {
      try { rmSync(downloadDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
