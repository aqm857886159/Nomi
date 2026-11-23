// 桌面主进程「这次启动是谁、想干什么」的唯一判定边界（#1629）。
//
// 为什么不把判断散落在各处的 `process.env.NOMI_MCP_STDIO === "1"` 里：
// 外部宿主（如 macOS 上的 ChatGPT Desktop 拉起 Codex 的本地 MCP 配置）可能剥离环境变量
// （ELECTRON_RUN_AS_NODE / NOMI_MCP_STDIO）。此时打包版 Nomi Helper 会落进 Electron 主进程
// `dist-electron/main.js`；若入口只认环境变量，它会误当交互桌面启动：先抢单实例锁再记
// `single-instance-exit` 自杀，同时把已有实例的 `second-instance` 叫醒，把收起的 Nomi 窗口拉到前台。
//
// 本模块是纯函数、零 electron 依赖：启动入口（main.ts）、生命周期（mainProcessLifecycle）、
// 监视器（stallMonitor）、遥测（sessionExit）、后台冷启（backgroundLaunch）与单实例交接
// （productionRunDesktopLifecycle）共用这一份身份判定。

export const MCP_STDIO_ARG = "--mcp-stdio";
export const BACKGROUND_LAUNCH_ARG = "--nomi-background-launch";

export type McpStdioScriptKind = "node-launcher" | "http-forwarder" | "server-entry";

export type DesktopLaunchMode =
  | { kind: "mcp-stdio"; reason: "env" | "flag" | "script"; scriptKind?: McpStdioScriptKind }
  | { kind: "background-desktop"; reason: "env" | "flag" }
  | { kind: "interactive-desktop" };

export type SecondInstanceAdditionalData = {
  launchIntent?: "background" | "interactive";
};

export type SecondInstanceDecision = {
  shouldRevealWindow: boolean;
  deepLink: string | null;
  reason:
    | "deep-link"
    | "interactive"
    | "mcp-stdio-arg"
    | "mcp-launcher-script"
    | "helper-executable"
    | "background-arg"
    | "background-additional-data";
};

const MCP_NODE_LAUNCHER_RE = /(?:^|[\\/])mcpNodeLauncher\.(?:[cm]?js|ts)$/i;
const MCP_HTTP_FORWARDER_RE = /(?:^|[\\/])mcpHttpForwarder\.(?:[cm]?js|ts)$/i;
const MCP_SERVER_ENTRY_RE = /(?:^|[\\/])mcpServerEntry\.(?:[cm]?js|ts)$/i;
const NOMI_HELPER_EXEC_RE = /(?:^|[\\/])Nomi Helper(?:\.app[\\/]Contents[\\/]MacOS[\\/]Nomi Helper)?$/i;

function matchMcpScriptKind(args: readonly string[]): McpStdioScriptKind | undefined {
  for (const arg of args) {
    if (typeof arg !== "string" || !arg) continue;
    if (MCP_NODE_LAUNCHER_RE.test(arg)) return "node-launcher";
    if (MCP_HTTP_FORWARDER_RE.test(arg)) return "http-forwarder";
    if (MCP_SERVER_ENTRY_RE.test(arg)) return "server-entry";
  }
  return undefined;
}

function isHelperExecutable(arg: string | undefined): boolean {
  return typeof arg === "string" && arg.length > 0 && NOMI_HELPER_EXEC_RE.test(arg);
}

/** 判定当前进程启动模式：MCP stdio（不碰单实例锁与 Dock）、后台桌面冷启、或普通交互桌面。 */
export function classifyProcessLaunch(
  input: { env?: NodeJS.ProcessEnv; argv?: readonly string[] } = {},
): DesktopLaunchMode {
  const env = input.env ?? process.env;
  const argv = input.argv ?? process.argv;
  const args = argv.slice(1);
  const scriptKind = matchMcpScriptKind(args);

  if (env.NOMI_MCP_STDIO === "1") {
    return scriptKind ? { kind: "mcp-stdio", reason: "env", scriptKind } : { kind: "mcp-stdio", reason: "env" };
  }
  if (args.includes(MCP_STDIO_ARG)) {
    return scriptKind ? { kind: "mcp-stdio", reason: "flag", scriptKind } : { kind: "mcp-stdio", reason: "flag" };
  }
  if (scriptKind) {
    return { kind: "mcp-stdio", reason: "script", scriptKind };
  }
  if (env.NOMI_LAUNCH_BACKGROUND === "1") {
    return { kind: "background-desktop", reason: "env" };
  }
  if (args.includes(BACKGROUND_LAUNCH_ARG)) {
    return { kind: "background-desktop", reason: "flag" };
  }
  return { kind: "interactive-desktop" };
}

export function isMcpStdioLaunch(input: { env?: NodeJS.ProcessEnv; argv?: readonly string[] } = {}): boolean {
  return classifyProcessLaunch(input).kind === "mcp-stdio";
}

export function isBackgroundDesktopLaunch(input: { env?: NodeJS.ProcessEnv; argv?: readonly string[] } = {}): boolean {
  return classifyProcessLaunch(input).kind === "background-desktop";
}

/**
 * 传入 `app.requestSingleInstanceLock(additionalData)` 的身份载荷：
 * 后台冷启若与已有实例发生单实例锁竞争，老实例据此识别这是后台启动，不把已收起的主窗拉到前台。
 */
export function singleInstanceLockData(mode: DesktopLaunchMode): SecondInstanceAdditionalData | undefined {
  return mode.kind === "background-desktop" ? { launchIntent: "background" } : undefined;
}

function hasBackgroundAdditionalData(additionalData: unknown): boolean {
  return Boolean(
    additionalData &&
      typeof additionalData === "object" &&
      (additionalData as SecondInstanceAdditionalData).launchIntent === "background",
  );
}

/**
 * 已有桌面实例收到 `second-instance` 时，决定是否把主窗恢复并切到前台：
 *   · 带 `nomi://` 深链 → 总是交由深链处理并显示主窗；
 *   · 命令行含 MCP stdio 入口脚本 / `--mcp-stdio` / `--nomi-background-launch`，或可执行文件为
 *     `Nomi Helper`，或 `additionalData.launchIntent === "background"` → 后台/无头调用，绝不叫回主窗；
 *   · 其余（用户双击应用图标 / 任务栏启动）→ 正常恢复并聚焦主窗。
 */
export function classifySecondInstance(
  commandLine: readonly string[],
  additionalData?: unknown,
): SecondInstanceDecision {
  const deepLink = commandLine.find((value) => typeof value === "string" && value.startsWith("nomi://")) ?? null;
  if (deepLink) {
    return { shouldRevealWindow: true, deepLink, reason: "deep-link" };
  }
  if (commandLine.includes(MCP_STDIO_ARG)) {
    return { shouldRevealWindow: false, deepLink: null, reason: "mcp-stdio-arg" };
  }
  if (matchMcpScriptKind(commandLine)) {
    return { shouldRevealWindow: false, deepLink: null, reason: "mcp-launcher-script" };
  }
  if (commandLine.includes(BACKGROUND_LAUNCH_ARG)) {
    return { shouldRevealWindow: false, deepLink: null, reason: "background-arg" };
  }
  if (hasBackgroundAdditionalData(additionalData)) {
    return { shouldRevealWindow: false, deepLink: null, reason: "background-additional-data" };
  }
  if (isHelperExecutable(commandLine[0])) {
    return { shouldRevealWindow: false, deepLink: null, reason: "helper-executable" };
  }
  return { shouldRevealWindow: true, deepLink: null, reason: "interactive" };
}
