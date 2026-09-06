// 端到端钉住那条不变量：**提示词 / 密钥 / 绝对路径不会落进日志文件**。
//
// 前面 redact.test.ts 钉的是脱敏函数本身；这里钉的是「一条真实调用走完整条路之后，
// 盘上那个文件里到底有什么」——两者缺一不可：函数对了但 logger 忘了调它，
// 只有这一层能发现。
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { dailyLogFileName } from "./logFiles";
import { currentLogFile, logError, logInfo, logVendorCall, logWarn, markStderrAsDiagnosticSurface } from "./logger";

function readLog(): string {
  const file = path.join(app.getPath("logs"), dailyLogFileName(new Date()));
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

describe("落盘出口", () => {
  it("写到 app.getPath('logs') 下的当天文件", () => {
    logInfo("main", "unit-probe");
    expect(currentLogFile()).toBe(path.join(app.getPath("logs"), dailyLogFileName(new Date())));
    expect(readLog()).toContain("unit-probe");
  });

  it("一行一条，带等级与模块域", () => {
    logWarn("catalog", "probe-warn", { vendor: "apimart" });
    const line = readLog().split("\n").find((l) => l.includes("probe-warn")) || "";
    expect(line).toMatch(/^\[[^\]]+\] WARN\s+catalog\s+probe-warn vendor=apimart$/);
  });

  it("想记提示词的调用点，盘上拿到的是占位符——不是提示词", () => {
    logInfo("ai", "probe-prompt", { prompt: "一只猫在下雨的东京街头回头", model: "seedance-1-0" });
    const log = readLog();
    expect(log).toContain("<omitted:prompt>");
    expect(log).not.toContain("东京");
    // 略掉提示词不等于把这条日志变哑：模型名照留。
    expect(log).toContain("model=seedance-1-0");
  });

  it("密钥与本机路径不落盘（连错误栈里的都不落）", () => {
    const error = Object.assign(new Error("write failed"), {
      code: "EACCES",
      stack: [
        "Error: write failed",
        "    at copyAssetFile (/Users/someone/Desktop/Nomi/dist-electron/assets.js:12:5)",
      ].join("\n"),
    });
    logError("assets", "probe-error", error, { reason: "Bearer sk-abcdef0123456789" });
    const log = readLog();
    expect(log).toContain("code=EACCES");
    expect(log).toContain("assets.js:12:5");
    expect(log).not.toContain("/Users/someone");
    expect(log).not.toContain("sk-abcdef");
  });

  it("供应商调用只留六字段摘要，失败按 WARN 记", () => {
    logVendorCall({ vendor: "api.apimart.ai", model: "seedance-1-0", status: 502, ms: 1843.6, requestId: "req_0123456789abcdef", costUsd: 0.32 });
    const line = readLog().split("\n").find((l) => l.includes("api.apimart.ai")) || "";
    expect(line).toContain("WARN ");
    expect(line).toContain("vendor=api.apimart.ai model=seedance-1-0 status=502 ms=1844");
    expect(line).toContain("cost=0.3200");
    // 请求 id 截短：够对账，又不会长到被密钥形规则整段吃掉。
    expect(line).toContain("req=req_01234567");
  });

  it("成功的供应商调用按 INFO 记", () => {
    logVendorCall({ vendor: "api.kie.ai", model: "veo-3", status: 200, ms: 12 });
    const line = readLog().split("\n").find((l) => l.includes("api.kie.ai")) || "";
    expect(line).toContain("INFO ");
  });
});

// MCP stdio 进程里 stderr 不是「开发时的终端」，而是**宿主协议面**：stdout 整条让给了 JSON-RPC，
// 宿主（Claude Code / Codex）唯一能看见我们诊断的地方就是 stderr。日志收口那次差点把它当成
// dev 便利关掉（打包版 mirrorToStderr 直接 return）——那样一来真实宿主拉起的打包版会彻底哑掉，
// 而 L1 回归跑的是未打包实例，看不见这个洞。这条测试就是那个洞的锁：
// 单测环境里 electron stub 没有 isPackaged（→ 按已打包处理），点了开关仍必须写出去。
describe("宿主协议面（stderr）", () => {
  it("被标记成宿主诊断面后，打包态也照样同步写 stderr", () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      markStderrAsDiagnosticSurface();
      logWarn("mcp", "probe-host-surface", { limitBytes: 4194304 });
    } finally {
      spy.mockRestore();
    }
    expect(written.join("")).toContain("[nomi:mcp] probe-host-surface limitBytes=4194304");
  });
});
