/** 诊断包的中立契约（渲染层只依赖这里，不伸手进主进程实现）。 */

export type DiagnosticsBundleEntry = {
  /** zip 内路径。 */
  path: string;
  bytes: number;
  /** 这份东西是什么、为什么在包里——清单要能自解释，别让收到 zip 的人猜。 */
  what: string;
};

/** 被刻意排除的东西 + 原因。诚实交付（D4）：包里没有什么，比包里有什么更容易引起误解。 */
export type DiagnosticsBundleExclusion = { what: string; why: string };

/** 卡顿时间线在这个包里的三态（见 `electron/diagnostics/stallTimeline.ts`）。 */
export type DiagnosticsStallTimeline = {
  /** recorded = 有记录；none-this-session = 监视器在跑、但没记到可用的行；monitor-not-running = 监视器没运行。 */
  state: "recorded" | "none-this-session" | "monitor-not-running";
  /** 盘上的文件：present / absent（新装或旧版本升级上来）/ unreadable。 */
  file: "present" | "absent" | "unreadable";
  /** 进包的行数（通过白名单校验的）。 */
  rows: number;
  /** 其中本次启动写下的行数；用户重启后再导出时这里可以是 0，上次的行仍在 rows 里。 */
  rowsThisSession: number;
  /** 读到但不合格、没进包的行数（坏数据 / 半行 / 别的版本写的）。 */
  droppedLines: number;
  /** 监视器没运行时的原因码。 */
  reason?: "not-installed" | "install-failed";
  /** 给收包的人读的一句话。 */
  note: string;
};

type FactValue = string | number | boolean;

/** 显卡与屏幕：全是取值有限的标量，没有显示器名 / 设备 id / 路径。 */
export type DiagnosticsHardware = {
  gpu:
    | {
        available: true;
        /** `app.getGPUFeatureStatus()`：功能 → 状态码。 */
        featureStatus: Record<string, string>;
        /** `app.getGPUInfo("basic")` 的白名单字段。 */
        devices: Record<string, FactValue>[];
        aux: Record<string, FactValue>;
        machineModel: { name: string; version: string };
      }
    | { available: false; reason: string };
  displays: { width: number; height: number; scaleFactor: number; refreshRate: number | null; primary: boolean }[];
  /** 主窗口；没有窗口时为 null。devicePixelRatio 取窗口所在显示器的缩放系数。 */
  window: { width: number; height: number; maximized: boolean; fullscreen: boolean; devicePixelRatio: number } | null;
};

/** 工程体量：只有数字，不含内容。 */
export type DiagnosticsProjectSize =
  | {
      available: true;
      projectJsonBytes: number;
      /** 画布节点数；工程文件读不了 / 解析不了时为 null。 */
      nodeCount: number | null;
      eventLogBytes: number;
    }
  | { available: false; reason: string };

export type DiagnosticsBundleManifest = {
  schemaVersion: 1;
  createdAt: string;
  app: { version: string; electron: string; node: string; chrome: string };
  system: { platform: string; arch: string; osRelease: string; locale: string; timeZone: string };
  /** 当前项目 id；没有打开项目时为 null。 */
  projectId: string | null;
  entries: DiagnosticsBundleEntry[];
  excluded: DiagnosticsBundleExclusion[];
  totalBytes: number;
};

/**
 * 设置页「导出诊断」那个包的清单 = 通用清单 + 三块只有它才有的事实。
 * 反馈包（`feedbackReport.ts`）共用上面的通用形状，不带这三块——它不收时间线，也不该假装收了。
 */
export type DiagnosticsExportManifest = DiagnosticsBundleManifest & {
  stallTimeline: DiagnosticsStallTimeline;
  hardware: DiagnosticsHardware;
  projectSize: DiagnosticsProjectSize;
};

export type DiagnosticsExportResult =
  | { ok: true; filePath: string; entryCount: number; totalBytes: number }
  | { ok: false; reason: "canceled" | "failed" };
