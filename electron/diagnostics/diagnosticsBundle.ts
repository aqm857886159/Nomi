// 诊断包的组装（纯 fs 读 + 内存打包，不碰 Electron API，好单测）。
//
// 它解决的摩擦：用户报「导出失败了 / 模型调不通」时，我们要么让他重现一遍，要么盲猜。
// 这个包让他一次性把「够我们定位」的东西交出来——**由他自己决定保存到哪、发不发**，
// 我们不自动上传任何东西。
//
// 收什么、不收什么，判据只有一条：**排查必需，且不是创作内容或凭据**。
// 每一项在清单里都写明「这是什么」，被排除的东西也写明「为什么没有」——
// 收到 zip 的人不该靠猜（D4 诚实交付）。
import fs from "node:fs";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { listLogFilesForBundle } from "../logging/logFiles";
import { redactModelCatalog } from "./catalogRedaction";
import { stallRowsToJsonl, type StallTimelineRead } from "./stallTimeline";
import type {
  DiagnosticsBundleEntry,
  DiagnosticsBundleExclusion,
  DiagnosticsExportManifest,
  DiagnosticsHardware,
  DiagnosticsProjectSize,
  DiagnosticsStallTimeline,
} from "../shared/contracts/diagnostics";

/** zip 总量上限。超了先丢最旧的日志——它们是包里最大也最可替代的部分。 */
export const DIAGNOSTICS_BUNDLE_MAX_BYTES = 25 * 1024 * 1024;

/** 制作收据只取最近这么多个 run：再往前的对「刚刚出的问题」没有价值。 */
const MAX_RUN_RECEIPTS = 20;

export type DiagnosticsBundleInput = {
  logsDir: string;
  /** 设置根目录（`model-catalog.json` 的家）。 */
  settingsRoot: string;
  projectId: string | null;
  /** 当前项目根目录；拿不到（没开项目 / 目录不在了）时为 null。 */
  projectDir: string | null;
  /** 当前项目的 Agent 命令账本；拿不到身份时为 null。 */
  agentLedgerPath: string | null;
  /** 拿不到项目身份时的原因，写进清单的 excluded。 */
  agentLedgerUnavailableReason?: string;
  /** 卡顿时间线：监视器此刻的状态 + 从盘上读回的行（读回是纯 fs，不在这里做）。 */
  stallTimeline: {
    monitor: { running: boolean; reason?: "not-installed" | "install-failed"; rowsThisSession: number };
    read: StallTimelineRead;
  };
  /** 显卡 / 屏幕 / 窗口（要问 Electron，由 IPC 层收集）。 */
  hardware: DiagnosticsHardware;
  /** 工程体量数字（要解析工程文件，由 IPC 层收集）。 */
  projectSize: DiagnosticsProjectSize;
  now: Date;
  app: { version: string; electron: string; node: string; chrome: string };
  system: { platform: string; arch: string; osRelease: string; locale: string; timeZone: string };
};

export type DiagnosticsBundle = {
  zip: Uint8Array;
  manifest: DiagnosticsExportManifest;
};

function readFileOrNull(file: string): Uint8Array | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    return new Uint8Array(fs.readFileSync(file));
  } catch {
    return null;
  }
}

/** `<projectDir>/.nomi/runs/<runId>/run.json`，按目录名倒序取最近若干个。 */
function collectRunReceipts(projectDir: string): { runId: string; file: string }[] {
  const runsRoot = path.join(projectDir, ".nomi", "runs");
  let runIds: string[];
  try {
    runIds = fs
      .readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
      .slice(0, MAX_RUN_RECEIPTS);
  } catch {
    return [];
  }
  return runIds
    .map((runId) => ({ runId, file: path.join(runsRoot, runId, "run.json") }))
    .filter((item) => fs.existsSync(item.file));
}

/** 时间线三态的判定 + 给收包的人读的一句话。监视器没运行时，盘上的旧行（上次启动记下的）照常带上。 */
export function describeStallTimeline(input: DiagnosticsBundleInput["stallTimeline"]): DiagnosticsStallTimeline {
  const { monitor, read } = input;
  const base = { file: read.file, rows: read.rows.length, rowsThisSession: monitor.rowsThisSession, droppedLines: read.droppedLines };
  const scope = "只含时间、类型、时长、所在页、是否在生成、节点数档位；不含内容与路径";
  if (!monitor.running) {
    return {
      ...base,
      state: "monitor-not-running",
      reason: monitor.reason ?? "not-installed",
      note: `停顿监视器未运行（${monitor.reason ?? "not-installed"}），本次启动没有新记录；${read.rows.length ? `盘上有以前启动留下的 ${read.rows.length} 行，已带上。` : "盘上也没有以前的记录。"}${scope}。`,
    };
  }
  if (read.rows.length === 0) {
    return {
      ...base,
      state: "none-this-session",
      note: `监视器在运行，本次没记到约 100ms 以上的主进程停顿、200ms 以上的界面长帧或窗口无响应${read.file === "present" ? "（时间线文件在，里面没有可用的行）" : "（还没有时间线文件）"}。${scope}。`,
    };
  }
  return {
    ...base,
    state: "recorded",
    note: `共 ${read.rows.length} 行，其中本次启动 ${monitor.rowsThisSession} 行（重启前的记录也在）。主进程那一行的时间精确到 10 秒窗口末尾，时长误差约 ±32ms。${scope}。`,
  };
}

export function buildDiagnosticsBundle(input: DiagnosticsBundleInput): DiagnosticsBundle {
  const files: Record<string, Uint8Array> = {};
  const entries: DiagnosticsBundleEntry[] = [];
  const excluded: DiagnosticsBundleExclusion[] = [];
  let totalBytes = 0;

  const add = (zipPath: string, bytes: Uint8Array, what: string): boolean => {
    if (totalBytes + bytes.length > DIAGNOSTICS_BUNDLE_MAX_BYTES) {
      excluded.push({ what: zipPath, why: "bundle-size-limit" });
      return false;
    }
    files[zipPath] = bytes;
    entries.push({ path: zipPath, bytes: bytes.length, what });
    totalBytes += bytes.length;
    return true;
  };

  // ① 日志。新的排在前面，超总量上限时被丢掉的一定是最旧的那几天（见 listLogFilesForBundle）。
  for (const name of listLogFilesForBundle(input.logsDir)) {
    const bytes = readFileOrNull(path.join(input.logsDir, name));
    if (!bytes) continue;
    add(
      `logs/${name}`,
      bytes,
      name.includes("crash") ? "崩溃与进程死亡记录" : "运行日志：主进程 + 界面上报的失败（写入时已脱敏）",
    );
  }

  // ② 模型目录（脱敏后）。留结构与 base URL，抹全部凭据材料。
  const catalogRaw = readFileOrNull(path.join(input.settingsRoot, "model-catalog.json"));
  if (catalogRaw) {
    try {
      const parsed = JSON.parse(Buffer.from(catalogRaw).toString("utf8")) as unknown;
      add(
        "model-catalog.json",
        strToU8(`${JSON.stringify(redactModelCatalog(parsed), null, 2)}\n`),
        "模型目录：接了哪几家、每家 base URL、报文映射与健康度（key 字段已抹）",
      );
    } catch {
      // 解析不了就整份不收：一份坏 JSON 我们没法保证抹干净，宁可不给。
      excluded.push({ what: "model-catalog.json", why: "unparseable-json-cannot-guarantee-redaction" });
    }
  } else {
    excluded.push({ what: "model-catalog.json", why: "not-found" });
  }

  // ③ 当前项目的 Agent 命令账本。
  //    这一份**含创作内容**（Agent 收到与发出的命令）。它仍然在包里，因为它是 Agent 出问题时
  //    唯一能复盘「到底执行了什么」的东西，而这个包是用户主动导出到自己盘上的自有数据；
  //    清单里把这件事写明，导出前界面上也写明——由用户决定发不发。
  if (input.agentLedgerPath) {
    const ledger = readFileOrNull(input.agentLedgerPath);
    if (ledger) add("project/commands-v1.jsonl", ledger, "当前项目的 Agent 命令账本（⚠️ 含创作内容）");
    else excluded.push({ what: "project/commands-v1.jsonl", why: "not-found" });
  } else {
    excluded.push({
      what: "project/commands-v1.jsonl",
      why: input.agentLedgerUnavailableReason || "no-active-project",
    });
  }

  // ④ 制作运行收据。只取 run.json（状态机快照）——brief / script / storyboard 那些产物
  //    整篇都是提示词，不进包。
  if (input.projectDir) {
    const receipts = collectRunReceipts(input.projectDir);
    for (const receipt of receipts) {
      const bytes = readFileOrNull(receipt.file);
      if (bytes) add(`project/runs/${receipt.runId}/run.json`, bytes, "制作运行收据（状态机快照）");
    }
    if (!receipts.length) excluded.push({ what: "project/runs/*/run.json", why: "no-production-runs" });
  }
  // ⑤ 卡顿时间线。只收通过白名单校验的行，并重新序列化——盘上的原文件不原样进包，
  //    所以别的版本写的、被改过的、写坏的行到这里就出不去了。
  const stallTimeline = describeStallTimeline(input.stallTimeline);
  if (input.stallTimeline.read.rows.length) {
    const added = add(
      "stall-timeline.jsonl",
      strToU8(stallRowsToJsonl(input.stallTimeline.read.rows)),
      "卡顿时间线（本机记录，约 100ms 以上的主进程停顿 / 200ms 以上的界面长帧 / 窗口无响应与恢复；只含时间、类型、时长、所在页、是否在生成、节点数档位）",
    );
    if (!added) excluded.push({ what: "stall-timeline.jsonl", why: "bundle-size-limit" });
  } else {
    excluded.push({ what: "stall-timeline.jsonl", why: stallTimeline.state });
  }
  excluded.push({
    what: "project/runs/*/{brief,script,storyboard,direction}-v*.json",
    why: "creative-content-by-design",
  });
  excluded.push({ what: "api-keys / prompts / asset paths", why: "never-collected-by-design" });

  const manifest: DiagnosticsExportManifest = {
    schemaVersion: 1,
    createdAt: input.now.toISOString(),
    app: input.app,
    system: input.system,
    projectId: input.projectId,
    entries,
    excluded,
    totalBytes,
    stallTimeline,
    hardware: input.hardware,
    projectSize: input.projectSize,
  };

  // 清单最后加：它要如实描述已经进包的那些条目，所以必须在其余条目定稿之后。
  files["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  return { zip: zipSync(files, { level: 6 }), manifest };
}

/** 保存对话框的默认文件名：带时间戳，用户一次导出多份也不会互相覆盖。 */
export function diagnosticsBundleFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[:T]/g, "-").slice(0, 16);
  return `nomi-diagnostics-${stamp}.zip`;
}
