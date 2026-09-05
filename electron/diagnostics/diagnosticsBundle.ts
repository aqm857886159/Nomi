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
import type {
  DiagnosticsBundleEntry,
  DiagnosticsBundleExclusion,
  DiagnosticsBundleManifest,
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
  now: Date;
  app: { version: string; electron: string; node: string; chrome: string };
  system: { platform: string; arch: string; osRelease: string; locale: string; timeZone: string };
};

export type DiagnosticsBundle = {
  zip: Uint8Array;
  manifest: DiagnosticsBundleManifest;
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
      name.includes("crash") ? "崩溃与进程死亡记录" : "主进程运行日志（写入时已脱敏）",
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
  excluded.push({
    what: "project/runs/*/{brief,script,storyboard,direction}-v*.json",
    why: "creative-content-by-design",
  });
  excluded.push({ what: "api-keys / prompts / asset paths", why: "never-collected-by-design" });

  const manifest: DiagnosticsBundleManifest = {
    schemaVersion: 1,
    createdAt: input.now.toISOString(),
    app: input.app,
    system: input.system,
    projectId: input.projectId,
    entries,
    excluded,
    totalBytes,
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
