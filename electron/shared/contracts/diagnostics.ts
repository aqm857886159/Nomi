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

export type DiagnosticsExportResult =
  | { ok: true; filePath: string; entryCount: number; totalBytes: number }
  | { ok: false; reason: "canceled" | "failed" };
