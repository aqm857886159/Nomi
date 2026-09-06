// 主进程日志的**唯一**文件写手（P1：仓库里只有这一份滚动落盘实现）。
//
// 两条日志道共用它：
//   · 崩溃道 —— `crashLog.ts` 的 `nomi-crash.log`，2MB 到顶就地清空（保留它原有语义）；
//   · 通用道 —— `logger.ts` 的 `nomi-YYYY-MM-DD.log`，按天一个文件、超限改名留一代、过期清理。
//
// 为什么不用 electron-log（R20 三问的落点，详见
// docs/plan/2026-09-06-logging-and-diagnostics-bundle.md §3）：它的滚动模型只有
// 「maxSize → .old.log」一种，按天与保留期照样得自己写；而崩溃面包屑必须
// `appendFileSync` 且不依赖任何可能自己抛错的第三方（`crashLog.ts` 顶部注释里的那条约束），
// 换不过去。引入它的净结果是仓库里两个文件写手 + 两套滚动策略 —— 正是 P1 要禁的并行版。
//
// 纪律：**这里所有写路径都吞异常**。丢一行日志是可以接受的；因为写日志失败而把 app 带走不是。
// 同理这个文件里一行 console.* 都不许有（`check:main-console` 硬零，且崩溃道的调用点
// 正处在「stderr 本身可能已经坏了」的场景里）。
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

/** 通用道单个日志文件的上限。超过就改名留一代，见 `archivePathFor`。 */
export const DAILY_LOG_MAX_BYTES = 4 * 1024 * 1024;

/** 通用道保留天数。过期文件在跨天后的第一次写入时清掉。 */
export const LOG_RETENTION_DAYS = 7;

/** 通用道文件名，形如 `nomi-2026-09-06.log`（`.1` 是滚动出来的那一代）。 */
const DAILY_LOG_PATTERN = /^nomi-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;

export const CRASH_LOG_FILE_NAME = "nomi-crash.log";

/** macOS: ~/Library/Logs/<app>。目录不存在就建。失败时返回路径，由写手吞掉后续异常。 */
export function logsDir(): string {
  const dir = app.getPath("logs");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* 目录建不出来时 append 会失败并被吞掉，不在这里抛 */
  }
  return dir;
}

/** 本地日期（不是 UTC）：用户说「昨天那次」指的是他自己的昨天。 */
export function isoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dailyLogFileName(date: Date): string {
  return `nomi-${isoDay(date)}.log`;
}

/**
 * 滚动后那一代的路径：`nomi-2026-09-06.log` → `nomi-2026-09-06.1.log`。
 * 只留一代——再多就变成「按大小的第二套保留期」，两套保留期互相打架时谁也说不清盘上还剩什么。
 */
export function archivePathFor(file: string): string {
  return file.endsWith(".log") ? `${file.slice(0, -".log".length)}.1.log` : `${file}.1`;
}

/**
 * 每个文件的首行：哪个构建、哪个平台。滚动会把表头冲掉，所以滚动后要补写一行——
 * 否则后半段日志无版本可归属，拿到用户回报也对不上号（沿用 crashLog 的判断）。
 */
export function sessionHeaderLine(): string {
  let version = "unknown";
  try {
    version = app.getVersion();
  } catch {
    /* app 未就绪时不阻断落盘 */
  }
  const electronVersion = process.versions.electron ?? "?";
  return `--- session nomi=${version} electron=${electronVersion} ${process.platform}-${process.arch} pid=${process.pid}`;
}

export type LogFileSink = {
  /** 同步追加一行（自带时间戳前缀）。任何失败都被吞掉。 */
  append(line: string): void;
  /** 当前会写到哪个文件——诊断包和测试用。 */
  currentFile(): string;
};

export type LogFileSinkOptions = {
  /** 每次写入都重新解析：通用道靠它实现「跨天自动换文件」。 */
  resolvePath: () => string;
  maxBytes: number;
  /** 到顶怎么处理旧内容：`truncate` 就地清空（崩溃道），`archive` 改名留一代（通用道）。 */
  rotate: "truncate" | "archive";
  /** 换到一个新文件时回调（首次写入、跨天、滚动后各一次）——通用道用它做保留期清理。 */
  onNewFile?: (file: string) => void;
};

export function createLogFileSink(options: LogFileSinkOptions): LogFileSink {
  // 「表头已经写过」的记号带上文件路径：跨天换文件后必须重新写表头，
  // 而同一个文件内不该反复写。只记一个 boolean 会在跨天那天丢掉表头。
  let stampedFile = "";
  let file = "";

  const resolve = (): string => {
    file = options.resolvePath();
    return file;
  };

  return {
    append(line: string): void {
      try {
        const target = resolve();
        fs.mkdirSync(path.dirname(target), { recursive: true });

        let needsHeader = target !== stampedFile;
        if (needsHeader) options.onNewFile?.(target);

        try {
          if (fs.statSync(target).size > options.maxBytes) {
            if (options.rotate === "archive") fs.renameSync(target, archivePathFor(target));
            else fs.writeFileSync(target, "");
            needsHeader = true;
          }
        } catch {
          /* 文件还不存在：下面 appendFileSync 会创建它 */
        }

        const stamp = new Date().toISOString();
        if (needsHeader) {
          stampedFile = target;
          fs.appendFileSync(target, `[${stamp}] ${sessionHeaderLine()}\n`);
        }
        fs.appendFileSync(target, `[${stamp}] ${line}\n`);
      } catch {
        /* 落盘失败不应再抛：崩溃道的调用点正处在崩溃处理里，再抛一次就是递归 */
      }
    },
    currentFile(): string {
      return file || resolve();
    },
  };
}

/**
 * 清掉保留期外的通用道文件。按**文件名里的日期**判，不按 mtime——
 * 同步工具、备份还原、`touch` 都会改 mtime，而文件名里的那天是这批日志真正属于的那天。
 * 返回删掉的文件名，供测试与诊断包清单使用。
 */
export function pruneExpiredLogs(dir: string, retentionDays: number, now: Date): string[] {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (retentionDays - 1));
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    const match = DAILY_LOG_PATTERN.exec(name);
    if (!match) continue;
    const [year, month, day] = match[1].split("-").map(Number);
    if (new Date(year, month - 1, day) >= cutoff) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
      removed.push(name);
    } catch {
      /* 删不掉（占用/权限）就留着，下次再试 */
    }
  }
  return removed;
}

/**
 * 诊断包要收的日志文件，按「新的在前」排序（超总量上限时先截断旧的）。
 * 崩溃道排在最前：它是最稀缺的证据。
 */
export function listLogFilesForBundle(dir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const daily = names
    .filter((name) => DAILY_LOG_PATTERN.test(name))
    .sort()
    .reverse();
  const crash = names.filter((name) => name === CRASH_LOG_FILE_NAME);
  return [...crash, ...daily];
}
