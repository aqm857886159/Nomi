// 脱敏是这条日志道的**信任边界**，所以这里钉的不是「函数返回了什么」，
// 而是「这三类东西一个字都不许出现在输出里」：提示词、密钥、本机路径。
import { describe, expect, it } from "vitest";
import { capLogLine, isDeniedFieldName, redactError, redactField, redactLogValue } from "./redact";

describe("字段名黑名单（第一层：名字就说明了里面装的是什么）", () => {
  it.each([
    "prompt",
    "systemPrompt",
    "negative_prompt",
    "apiKey",
    "API-KEY",
    "vendorApiKey",
    "refreshToken",
    "authorization",
    "path",
    "filePath",
    "url",
    "assetPath",
    "projectName",
  ])("%s 整段略掉", (name) => {
    expect(isDeniedFieldName(name)).toBe(true);
    expect(redactField(name, "任何内容")).toMatch(/^<omitted:/);
  });

  it("排查真正需要的字段照常留下（脱敏不能把日志变哑）", () => {
    for (const name of ["vendor", "model", "status", "ms", "attempt", "runId", "jobId", "code", "reason"]) {
      expect(isDeniedFieldName(name)).toBe(false);
    }
    expect(redactField("vendor", "apimart")).toBe("apimart");
    expect(redactField("status", 502)).toBe("502");
  });

  it("略掉时保留字段名本身——「有个提示词被略掉了」和「这里什么都没有」是两件事", () => {
    expect(redactField("prompt", "一只猫在下雨的东京街头回头")).toBe("<omitted:prompt>");
  });
});

describe("值形态脱敏（第二层）", () => {
  it("绝对路径不出现", () => {
    expect(redactLogValue("/Users/someone/Documents/Nomi Projects/我的片子/a.mp4")).not.toContain("Users");
    expect(redactLogValue("failed at /Users/someone/x/y.png")).toBe("failed at <path>");
    expect(redactLogValue("C:\\Users\\someone\\Desktop\\a.png")).toBe("<path>");
    expect(redactLogValue("file:///Users/someone/a.png")).toBe("<path>");
    expect(redactLogValue("nomi-local://project/assets/a.png")).toBe("<path>");
  });

  it("URL 留 scheme+host（打的是哪家是排查必需），砍掉 path 与 query", () => {
    expect(redactLogValue("https://api.apimart.ai/v1/videos?token=abcdef123456")).toBe("https://api.apimart.ai/<path>");
    expect(redactLogValue("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
  });

  it("密钥形串不出现", () => {
    expect(redactLogValue("Authorization: Bearer sk-abcdef0123456789")).not.toContain("abcdef");
    expect(redactLogValue("sk-live-0123456789abcdef")).toBe("<redacted>");
    expect(redactLogValue("AKIAIOSFODNN7EXAMPLE")).toBe("<redacted>");
    expect(redactLogValue("a".repeat(48))).toBe("<redacted>");
  });

  it("合法事件名不许被密钥规则吃掉——抹过头比漏抹更糟：证据没了，还看不出是被抹的", () => {
    // 2026-09-06 实测过的回归：`api-key-decrypt-failed` 曾整条变成 <redacted>，
    // 于是那行日志只剩「某模块出了点什么事」。api/key 这两个前缀信号最弱，已从规则里去掉。
    for (const event of [
      "api-key-decrypt-failed",
      "key-status-probe-skipped",
      "relay-models-upgraded-to-native-wire",
      "single-shot-observation-failed",
    ]) {
      expect(redactLogValue(event)).toBe(event);
    }
    // 去掉那两个前缀不影响真正的密钥形串：它们要么带 sk-/Bearer 这种强前缀，要么够长。
    expect(redactLogValue("sk-live-0123456789abcdef")).toBe("<redacted>");
  });

  it("data: / blob: 整条抹掉（那就是内容本身）", () => {
    expect(redactLogValue("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg")).toBe("<blob>");
  });

  it("超长值截断——提示词没有可识别的特征，长度上限是它唯一的兜底", () => {
    const long = "猫".repeat(400);
    const out = redactLogValue(long);
    expect(out.length).toBeLessThan(230);
    expect(out).toContain("…(+200)");
  });

  it("控制字符压平，一行日志仍然是一行", () => {
    expect(redactLogValue("a\nb\tc")).toBe("a b c");
  });
});

describe("错误脱敏", () => {
  it("栈帧只留文件名:行:列，目录部分不出现", () => {
    const error = Object.assign(new Error("boom"), {
      stack: [
        "Error: boom",
        "    at hardenedFetch (/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/hardenedFetch.js:204:31)",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
      ].join("\n"),
    });
    const out = redactError(error);
    expect(out).toContain("Error: boom");
    expect(out).toContain("hardenedFetch.js:204:31");
    expect(out).not.toContain("/Applications");
    expect(out).not.toContain("app.asar");
  });

  it("带 errno code 的错误把 code 留下——那是这一族错误最有用的一个字", () => {
    const error = Object.assign(new Error("no such file"), { code: "ENOENT" });
    expect(redactError(error)).toContain("code=ENOENT");
  });

  it("非 Error 也走值脱敏", () => {
    expect(redactError("/Users/someone/x/y")).toBe("<path>");
  });
});

describe("整行上限", () => {
  it("超过 2000 字符截断", () => {
    expect(capLogLine("x".repeat(3000)).length).toBe(2001);
    expect(capLogLine("short")).toBe("short");
  });
});
