// Issue #1629 类回归测试：桌面进程启动身份与 second-instance 叫回判据。
//
// 目的（P2 判据 3）：
//   1) 外部宿主（如 ChatGPT Desktop 启动 Codex 的本地 MCP 配置）剥离 ELECTRON_RUN_AS_NODE 与
//      NOMI_MCP_STDIO 时，只要 argv 指向 MCP stdio 入口脚本（mcpNodeLauncher.js / mcpHttpForwarder.js /
//      mcpServerEntry.js）或显式 --mcp-stdio，进程必须被识别为 mcp-stdio，绝不抢单实例锁；
//   2) 老用户不重配（★1c）：已写入宿主配置里的旧 mcpNodeLauncher.js / mcpHttpForwarder.js 路径
//      在 macOS（Nomi Helper）和 Windows/Linux（Nomi.exe）下均自动命中；
//   3) 已有桌面实例收到 second-instance 时，后台 MCP / Helper / 后台冷启锁竞争绝不恢复或聚焦已收起的主窗；
//   4) 正对照：用户显式打开应用（无后台参数）或 nomi:// 深链必须正常叫回主窗（保证「全部拦下」与「什么都不做」都红）。
import { describe, expect, it } from "vitest";

import {
  BACKGROUND_LAUNCH_ARG,
  MCP_STDIO_ARG,
  classifyProcessLaunch,
  classifySecondInstance,
  isBackgroundDesktopLaunch,
  isMcpStdioLaunch,
  singleInstanceLockData,
} from "./desktopLaunchIntent";

type LaunchIntentMatrixRow = {
  label: string;
  env: NodeJS.ProcessEnv;
  argv: string[];
  expected: ReturnType<typeof classifyProcessLaunch>;
  expectedMcpStdio: boolean;
  expectedBackground: boolean;
  expectedLockData: ReturnType<typeof singleInstanceLockData>;
};

const LAUNCH_INTENT_MATRIX: readonly LaunchIntentMatrixRow[] = [
  {
    label: "macOS 打包版 Nomi Helper + mcpNodeLauncher.js（宿主剥离 env）→ mcp-stdio",
    env: {},
    argv: [
      "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
      "/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/capabilityCore/mcpNodeLauncher.js",
    ],
    expected: { kind: "mcp-stdio", reason: "script", scriptKind: "node-launcher" },
    expectedMcpStdio: true,
    expectedBackground: false,
    expectedLockData: undefined,
  },
  {
    label: "Windows 打包版 Nomi.exe + mcpNodeLauncher.js（宿主剥离 env）→ mcp-stdio",
    env: {},
    argv: [
      "C:\\Program Files\\Nomi\\Nomi.exe",
      "C:\\Program Files\\Nomi\\resources\\app.asar\\dist-electron\\capabilityCore\\mcpNodeLauncher.js",
    ],
    expected: { kind: "mcp-stdio", reason: "script", scriptKind: "node-launcher" },
    expectedMcpStdio: true,
    expectedBackground: false,
    expectedLockData: undefined,
  },
  {
    label: "Claude Desktop 转发口 mcpHttpForwarder.js（宿主剥离 env）→ mcp-stdio(http-forwarder)",
    env: {},
    argv: [
      "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
      "/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/capabilityCore/mcpHttpForwarder.js",
    ],
    expected: { kind: "mcp-stdio", reason: "script", scriptKind: "http-forwarder" },
    expectedMcpStdio: true,
    expectedBackground: false,
    expectedLockData: undefined,
  },
  {
    label: "显式 mcpServerEntry.js 脚本参数 → mcp-stdio(server-entry)",
    env: {},
    argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi", "/app/dist-electron/mcpServerEntry.js"],
    expected: { kind: "mcp-stdio", reason: "script", scriptKind: "server-entry" },
    expectedMcpStdio: true,
    expectedBackground: false,
    expectedLockData: undefined,
  },
  {
    label: "显式 --mcp-stdio 标志 → mcp-stdio(flag)",
    env: {},
    argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi", MCP_STDIO_ARG],
    expected: { kind: "mcp-stdio", reason: "flag" },
    expectedMcpStdio: true,
    expectedBackground: false,
    expectedLockData: undefined,
  },
  {
    label: "既有 NOMI_MCP_STDIO=1 环境变量 → mcp-stdio(env)",
    env: { NOMI_MCP_STDIO: "1" },
    argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi"],
    expected: { kind: "mcp-stdio", reason: "env" },
    expectedMcpStdio: true,
    expectedBackground: false,
    expectedLockData: undefined,
  },
  {
    label: "后台桌面冷启（NOMI_LAUNCH_BACKGROUND=1）→ background-desktop + lockData",
    env: { NOMI_LAUNCH_BACKGROUND: "1" },
    argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi"],
    expected: { kind: "background-desktop", reason: "env" },
    expectedMcpStdio: false,
    expectedBackground: true,
    expectedLockData: { launchIntent: "background" },
  },
  {
    label: "后台桌面冷启（--nomi-background-launch）→ background-desktop + lockData",
    env: {},
    argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi", BACKGROUND_LAUNCH_ARG],
    expected: { kind: "background-desktop", reason: "flag" },
    expectedMcpStdio: false,
    expectedBackground: true,
    expectedLockData: { launchIntent: "background" },
  },
  {
    label: "正对照：用户普通启动桌面应用 → interactive-desktop（无后台载荷）",
    env: {},
    argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi"],
    expected: { kind: "interactive-desktop" },
    expectedMcpStdio: false,
    expectedBackground: false,
    expectedLockData: undefined,
  },
];

type SecondInstanceMatrixRow = {
  label: string;
  commandLine: string[];
  additionalData?: unknown;
  expected: ReturnType<typeof classifySecondInstance>;
};

const SECOND_INSTANCE_MATRIX: readonly SecondInstanceMatrixRow[] = [
  {
    label: "Nomi Helper + mcpNodeLauncher.js 禁止抢焦点",
    commandLine: [
      "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
      "/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/capabilityCore/mcpNodeLauncher.js",
    ],
    expected: { shouldRevealWindow: false, deepLink: null, reason: "mcp-launcher-script" },
  },
  {
    label: "Nomi Helper + mcpHttpForwarder.js 禁止抢焦点",
    commandLine: [
      "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
      "/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/capabilityCore/mcpHttpForwarder.js",
    ],
    expected: { shouldRevealWindow: false, deepLink: null, reason: "mcp-launcher-script" },
  },
  {
    label: "显式 --mcp-stdio 参数禁止抢焦点",
    commandLine: ["/Applications/Nomi.app/Contents/MacOS/Nomi", MCP_STDIO_ARG],
    expected: { shouldRevealWindow: false, deepLink: null, reason: "mcp-stdio-arg" },
  },
  {
    label: "后台冷启参数 --nomi-background-launch 禁止抢焦点",
    commandLine: ["/Applications/Nomi.app/Contents/MacOS/Nomi", BACKGROUND_LAUNCH_ARG],
    expected: { shouldRevealWindow: false, deepLink: null, reason: "background-arg" },
  },
  {
    label: "单实例锁 additionalData.launchIntent=background 禁止抢焦点",
    commandLine: ["/Applications/Nomi.app/Contents/MacOS/Nomi"],
    additionalData: { launchIntent: "background" },
    expected: { shouldRevealWindow: false, deepLink: null, reason: "background-additional-data" },
  },
  {
    label: "即使宿主剥离 env 与 args，直接拉起 Nomi Helper 也禁止抢焦点",
    commandLine: [
      "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
    ],
    expected: { shouldRevealWindow: false, deepLink: null, reason: "helper-executable" },
  },
  {
    label: "正对照：空 commandLine 再次打开应叫回主窗",
    commandLine: [],
    expected: { shouldRevealWindow: true, deepLink: null, reason: "interactive" },
  },
  {
    label: "正对照：macOS 用户再次打开 Nomi.app 应叫回主窗",
    commandLine: ["/Applications/Nomi.app/Contents/MacOS/Nomi"],
    expected: { shouldRevealWindow: true, deepLink: null, reason: "interactive" },
  },
  {
    label: "正对照：Windows 用户再次打开 Nomi.exe 应叫回主窗",
    commandLine: ["C:\\Program Files\\Nomi\\Nomi.exe", "--allow-file-access-from-files"],
    expected: { shouldRevealWindow: true, deepLink: null, reason: "interactive" },
  },
  {
    label: "正对照：点击 nomi:// 深链应叫回主窗并透传深链",
    commandLine: ["/Applications/Nomi.app/Contents/MacOS/Nomi", "nomi://project/p1"],
    expected: { shouldRevealWindow: true, deepLink: "nomi://project/p1", reason: "deep-link" },
  },
];

describe("desktopLaunchIntent · 启动模式分流矩阵（#1629）", () => {
  it.each(LAUNCH_INTENT_MATRIX)("$label", ({ env, argv, expected, expectedMcpStdio, expectedBackground, expectedLockData }) => {
    const mode = classifyProcessLaunch({ env, argv });
    expect(mode).toEqual(expected);
    expect(isMcpStdioLaunch({ env, argv })).toBe(expectedMcpStdio);
    expect(isBackgroundDesktopLaunch({ env, argv })).toBe(expectedBackground);
    expect(singleInstanceLockData(mode)).toEqual(expectedLockData);
  });
});

describe("desktopLaunchIntent · second-instance 叫回判据矩阵（#1629）", () => {
  it.each(SECOND_INSTANCE_MATRIX)("$label", ({ commandLine, additionalData, expected }) => {
    expect(classifySecondInstance(commandLine, additionalData)).toEqual(expected);
  });
});
