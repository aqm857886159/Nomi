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

describe("desktopLaunchIntent · 启动模式分流（#1629）", () => {
  it("环境变量被宿主剥离时，凭打包版 Nomi Helper + mcpNodeLauncher.js 参数仍分流为 mcp-stdio", () => {
    const mode = classifyProcessLaunch({
      env: {},
      argv: [
        "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
        "/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/capabilityCore/mcpNodeLauncher.js",
      ],
    });
    expect(mode).toEqual({ kind: "mcp-stdio", reason: "script", scriptKind: "node-launcher" });
    expect(isMcpStdioLaunch({ env: {}, argv: [
      "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
      "/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/capabilityCore/mcpNodeLauncher.js",
    ] })).toBe(true);
    expect(singleInstanceLockData(mode)).toBeUndefined();
  });

  it("Windows 打包版路径、Claude Desktop 转发口 mcpHttpForwarder.js、mcpServerEntry.js 与显式 --mcp-stdio 均分流为 mcp-stdio", () => {
    expect(classifyProcessLaunch({
      env: {},
      argv: [
        "C:\\Program Files\\Nomi\\Nomi.exe",
        "C:\\Program Files\\Nomi\\resources\\app.asar\\dist-electron\\capabilityCore\\mcpNodeLauncher.js",
      ],
    })).toEqual({ kind: "mcp-stdio", reason: "script", scriptKind: "node-launcher" });

    expect(classifyProcessLaunch({
      env: {},
      argv: [
        "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
        "/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/capabilityCore/mcpHttpForwarder.js",
      ],
    })).toEqual({ kind: "mcp-stdio", reason: "script", scriptKind: "http-forwarder" });

    expect(classifyProcessLaunch({
      env: {},
      argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi", "/app/dist-electron/mcpServerEntry.js"],
    })).toEqual({ kind: "mcp-stdio", reason: "script", scriptKind: "server-entry" });

    expect(classifyProcessLaunch({
      env: {},
      argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi", MCP_STDIO_ARG],
    })).toEqual({ kind: "mcp-stdio", reason: "flag" });
  });

  it("保留既有 NOMI_MCP_STDIO=1 环境变量契约", () => {
    expect(classifyProcessLaunch({
      env: { NOMI_MCP_STDIO: "1" },
      argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi"],
    })).toEqual({ kind: "mcp-stdio", reason: "env" });
  });

  it("后台桌面冷启（NOMI_LAUNCH_BACKGROUND=1 或 --nomi-background-launch）向单实例锁透传 background 身份", () => {
    const envMode = classifyProcessLaunch({
      env: { NOMI_LAUNCH_BACKGROUND: "1" },
      argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi"],
    });
    expect(envMode).toEqual({ kind: "background-desktop", reason: "env" });
    expect(isBackgroundDesktopLaunch({ env: { NOMI_LAUNCH_BACKGROUND: "1" }, argv: [] })).toBe(true);
    expect(singleInstanceLockData(envMode)).toEqual({ launchIntent: "background" });

    const argMode = classifyProcessLaunch({
      env: {},
      argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi", BACKGROUND_LAUNCH_ARG],
    });
    expect(argMode).toEqual({ kind: "background-desktop", reason: "flag" });
    expect(singleInstanceLockData(argMode)).toEqual({ launchIntent: "background" });
  });

  it("正对照：用户普通启动桌面应用归为 interactive-desktop，不附加后台载荷", () => {
    const mode = classifyProcessLaunch({
      env: {},
      argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi"],
    });
    expect(mode).toEqual({ kind: "interactive-desktop" });
    expect(isMcpStdioLaunch({ env: {}, argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi"] })).toBe(false);
    expect(isBackgroundDesktopLaunch({ env: {}, argv: ["/Applications/Nomi.app/Contents/MacOS/Nomi"] })).toBe(false);
    expect(singleInstanceLockData(mode)).toBeUndefined();
  });
});

describe("desktopLaunchIntent · second-instance 叫回判据", () => {
  it("MCP 入口脚本、--mcp-stdio、Nomi Helper 可执行文件、后台冷启参数与 additionalData 均禁止抢焦点", () => {
    expect(classifySecondInstance([
      "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
      "/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/capabilityCore/mcpNodeLauncher.js",
    ])).toEqual({ shouldRevealWindow: false, deepLink: null, reason: "mcp-launcher-script" });

    expect(classifySecondInstance([
      "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
      "/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/capabilityCore/mcpHttpForwarder.js",
    ])).toEqual({ shouldRevealWindow: false, deepLink: null, reason: "mcp-launcher-script" });

    expect(classifySecondInstance(["/Applications/Nomi.app/Contents/MacOS/Nomi", MCP_STDIO_ARG]))
      .toEqual({ shouldRevealWindow: false, deepLink: null, reason: "mcp-stdio-arg" });

    expect(classifySecondInstance(["/Applications/Nomi.app/Contents/MacOS/Nomi", BACKGROUND_LAUNCH_ARG]))
      .toEqual({ shouldRevealWindow: false, deepLink: null, reason: "background-arg" });

    expect(classifySecondInstance(["/Applications/Nomi.app/Contents/MacOS/Nomi"], { launchIntent: "background" }))
      .toEqual({ shouldRevealWindow: false, deepLink: null, reason: "background-additional-data" });

    // 即使宿主把 env 和 args 全剥了，直接拉起 Nomi Helper 也绝不是用户点击 Nomi.app。
    expect(classifySecondInstance([
      "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
    ])).toEqual({ shouldRevealWindow: false, deepLink: null, reason: "helper-executable" });
  });

  it("正对照：用户显式再次打开 Nomi 或点击 nomi:// 深链必须叫回主窗", () => {
    expect(classifySecondInstance([])).toEqual({ shouldRevealWindow: true, deepLink: null, reason: "interactive" });
    expect(classifySecondInstance(["/Applications/Nomi.app/Contents/MacOS/Nomi"]))
      .toEqual({ shouldRevealWindow: true, deepLink: null, reason: "interactive" });
    expect(classifySecondInstance(["C:\\Program Files\\Nomi\\Nomi.exe", "--allow-file-access-from-files"]))
      .toEqual({ shouldRevealWindow: true, deepLink: null, reason: "interactive" });
    expect(classifySecondInstance(["/Applications/Nomi.app/Contents/MacOS/Nomi", "nomi://project/p1"]))
      .toEqual({ shouldRevealWindow: true, deepLink: "nomi://project/p1", reason: "deep-link" });
  });
});
