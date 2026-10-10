/**
 * 结构测试：主进程里**不经 appFetch 的出网口**，每一个都必须登记在下面这张表里（V-1047 B1，2026-10-06）。
 *
 * 为什么：付费提交「确定没离开本机」的判据（`outboundDispatchEvidence.observeSubmissionHandoffs`）读的是派发账——
 * HTTP 由 appFetch 记，子进程由 `child_process` 诊断通道记。账上看不见的出网口一旦出现在付费派发里，账就是 0 笔，
 * 一次已经交给供应商的提交会被说成「没发出」，用户重试 = 第二笔扣费。所以每个这样的口子只有两种合法处置：
 *   · `ledger`：派发账看得见它（目前只有异步子进程：spawn / exec / execFile / fork 都经 `child_process` 诊断通道）；
 *   · `outside-paid-dispatch`：它不在任何付费派发的调用链上，写清为什么。
 * 新加一个出网口没登记 → 红；登记了但代码里已经没有了 → 红（表不许烂）。
 *
 * 普通 Node HTTP（http / https / undici / 全局 fetch）不在这里：`check:network-entry` 已经要求它们只走 appFetch。
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Primitive = "child-process" | "child-process-sync" | "websocket" | "chromium-net" | "raw-socket" | "isolated-runtime" | "ai-sdk";
type Entry = { disposition: "ledger" | "outside-paid-dispatch"; reason: string };

const CHILD_ASYNC: Entry = { disposition: "ledger", reason: "异步子进程：每个 ChildProcess 都经 child_process 诊断通道进派发账" };
const LOCAL_MEDIA = (what: string): Entry => ({ disposition: "outside-paid-dispatch", reason: `本机媒体处理（${what}），不出网，也不在付费派发里` });

/** key = `相对路径#出网口`。 */
const REGISTRY: Record<string, Entry> = {
  "electron/catalog/dreaminaCli.ts#child-process": { ...CHILD_ASYNC, reason: "即梦 CLI：runTask process 分支的付费出网口，靠 child_process 诊断通道记账（矩阵 CLI 各格）" },
  "electron/ai/antigravityProcess.ts#child-process": { ...CHILD_ASYNC, reason: "Antigravity CLI 执行：runTask process 分支的付费出网口，靠 child_process 诊断通道记账" },
  "electron/ai/antigravityConnection.ts#child-process": { ...CHILD_ASYNC, reason: "Antigravity 预检（版本 / 模型清单）；在付费派发里起的话也进账（只会更保守）" },
  "electron/catalog/dreaminaLoginIpc.ts#child-process": { ...CHILD_ASYNC, reason: "即梦登录 / 余额：设置页 IPC，不在付费派发里；即使被调进派发也进账" },
  "electron/catalog/codexCli.ts#child-process": CHILD_ASYNC,
  "electron/agentLane/laneCodingSandbox.mts#child-process": CHILD_ASYNC,
  "electron/capabilityCore/mcpNodeLauncher.ts#child-process": CHILD_ASYNC,
  "electron/capabilityCore/mcpVerify.ts#child-process": CHILD_ASYNC,
  "electron/attentionSoundPlayer.ts#child-process": CHILD_ASYNC,
  "electron/assets/videoImportNormalize.ts#child-process": CHILD_ASYNC,
  "electron/export/ffmpegRunner.ts#child-process": CHILD_ASYNC,
  "electron/video/trimVideo.ts#child-process": { ...CHILD_ASYNC, reason: "视频节点直接剪辑：本机 ffmpeg 只读写本地文件、不联网，不在付费派发里" },
  "electron/export/mediaProbe.ts#child-process": CHILD_ASYNC,
  "electron/localSpeech/localSpeechInstall.ts#child-process": CHILD_ASYNC,
  "electron/localSpeech/localSpeechServer.ts#child-process": CHILD_ASYNC,
  "electron/localSpeech/localSpeechTranscribe.ts#child-process": CHILD_ASYNC,
  "electron/review/technicalCheck.ts#child-process": CHILD_ASYNC,
  "electron/video/depthVideoJob.ts#child-process": CHILD_ASYNC,
  "electron/video/detectShotCuts.ts#child-process": CHILD_ASYNC,
  "electron/video/extractAudioTrack.ts#child-process": CHILD_ASYNC,
  "electron/video/extractVideoFrame.ts#child-process": CHILD_ASYNC,
  "electron/video/framesToVideo.ts#child-process": CHILD_ASYNC,
  "electron/providerAdapter/tests/serviceReservationRaceFixture.ts#child-process": CHILD_ASYNC,
  "electron/productionRun/productionRunE2eFixture.ts#child-process": CHILD_ASYNC,
  "electron/productionRun/productionRunE2eFixture.ts#child-process-sync": { disposition: "outside-paid-dispatch", reason: "测试夹具里同步跑 ffmpeg 造片源，不进生产包的付费路径" },
  "electron/assets/generatedMediaDecode.ts#child-process": CHILD_ASYNC,
  "electron/assets/generatedMediaDecode.ts#child-process-sync": LOCAL_MEDIA("产物落盘前用 ffprobe 同步解码校验，发生在受理之后的取回里"),
  "electron/ai/fixtures/antigravity.mjs#child-process": { disposition: "outside-paid-dispatch", reason: "测试用的 Antigravity CLI 替身脚本（它自己就是被 spawn 的那个进程），不进生产付费路径" },
  "electron/ai/fixtures/antigravity.mjs#child-process-sync": { disposition: "outside-paid-dispatch", reason: "同上：替身脚本内部同步探环境，不是 Nomi 主进程的出网口" },
  "electron/comfyuiProgressSocket.ts#websocket": { disposition: "outside-paid-dispatch", reason: "本机 ComfyUI 的进度推送（只听不交）；本机 ComfyUI 不进制作 Run（登记的例外），提交走 HTTP" },
  "electron/director/mobileBridgeServer.ts#websocket": { disposition: "outside-paid-dispatch", reason: "手机遥控的本机 WebSocket 服务端，只收不发付费请求" },
  "electron/browser/media/browserViewMedia.ts#chromium-net": { disposition: "outside-paid-dispatch", reason: "内置浏览器里下载网页媒体（用户在浏览器里点的），不是生成提交" },
  "electron/ai/buildAiSdkModel.ts#ai-sdk": { disposition: "outside-paid-dispatch", reason: "AI SDK 的 fetch 全部注入为 appFetch（buildProfiledFetch / 显式 fetch 参数），本身不另起出网口" },
};

const CHILD_MODULES = new Set(["child_process", "node:child_process"]);
const SYNC_CHILD = new Set(["spawnSync", "execSync", "execFileSync"]);
const NET_MODULES = new Set(["net", "node:net", "tls", "node:tls"]);

function moduleOf(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) return node.moduleSpecifier.text;
  if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
    && ((ts.isIdentifier(node.expression) && node.expression.text === "require") || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
    return node.arguments[0].text;
  }
  return undefined;
}

export function egressPrimitives(file: string, source: string): Set<Primitive> {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = new Set<Primitive>();
  let importsChild = false;
  let importsNet = false;
  let electronNet = false;
  const visit = (node: ts.Node) => {
    const module = moduleOf(node);
    if (module && CHILD_MODULES.has(module)) importsChild = true;
    if (module && NET_MODULES.has(module)) importsNet = true;
    if (module === "ws") found.add("websocket");
    if (module === "worker_threads" || module === "node:worker_threads") found.add("isolated-runtime");
    if (module?.startsWith("@ai-sdk/")) found.add("ai-sdk");
    if (module === "electron" && ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
        const name = (element.propertyName ?? element.name).text;
        if (name === "net") electronNet = true;
        if (name === "utilityProcess") found.add("isolated-runtime");
      }
    }
    if (ts.isIdentifier(node) && SYNC_CHILD.has(node.text)) found.add("child-process-sync");
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "WebSocket") found.add("websocket");
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const target = node.expression.expression.getText(ast);
      if (name === "fetch" && /(^|\.)session$/.test(target)) found.add("chromium-net");
      if (electronNet && target === "net" && (name === "request" || name === "fetch")) found.add("chromium-net");
      if (importsNet && (name === "connect" || name === "createConnection")) found.add("raw-socket");
    }
    if (ts.isNewExpression(node) && importsNet && /(^|\.)Socket$/.test(node.expression.getText(ast))) found.add("raw-socket");
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (importsChild) found.add("child-process");
  else found.delete("child-process-sync");
  return found;
}

function productionSources(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); continue; }
      if (/\.(?:ts|mts|cts|js|mjs|cjs)$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, "electron"));
  return files;
}

const repoRoot = path.resolve(__dirname, "..");

describe("不经 appFetch 的出网口全部登记（派发账看得见，或不在付费派发里）", () => {
  const found = new Map<string, Primitive>();
  for (const file of productionSources(repoRoot)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    for (const primitive of egressPrimitives(rel, fs.readFileSync(file, "utf8"))) found.set(`${rel}#${primitive}`, primitive);
  }

  it("每一个出网口都有登记", () => {
    const missing = [...found.keys()].filter((key) => !REGISTRY[key]);
    expect(missing, "新的不经 appFetch 的出网口：在付费派发里就要让派发账看得见（或改走 appFetch），否则在这里写清为什么不在付费派发里").toEqual([]);
  });

  it("登记表不烂：登记了的出网口代码里都还在", () => {
    expect(Object.keys(REGISTRY).filter((key) => !found.has(key))).toEqual([]);
  });

  it("只有异步子进程能登记成 ledger（只有它有诊断通道替它记账）", () => {
    const wrong = Object.entries(REGISTRY).filter(([key, entry]) => entry.disposition === "ledger" && found.get(key) !== "child-process");
    expect(wrong.map(([key]) => key)).toEqual([]);
  });

  it("扫描器认得出每一种出网口（先验它会红）", () => {
    expect([...egressPrimitives("a.ts", `import { spawnSync } from "node:child_process"; spawnSync("x")`)].sort()).toEqual(["child-process", "child-process-sync"]);
    expect([...egressPrimitives("a.ts", `const ws = new WebSocket("wss://x")`)]).toEqual(["websocket"]);
    expect([...egressPrimitives("a.ts", `win.webContents.session.fetch("https://x")`)]).toEqual(["chromium-net"]);
    expect([...egressPrimitives("a.ts", `import { net } from "electron"; net.request("https://x")`)]).toEqual(["chromium-net"]);
    expect([...egressPrimitives("a.ts", `import tls from "node:tls"; tls.connect(443, "x")`)]).toEqual(["raw-socket"]);
    expect([...egressPrimitives("a.ts", `import { utilityProcess } from "electron"`)]).toEqual(["isolated-runtime"]);
    expect([...egressPrimitives("a.ts", `import { createOpenAI } from "@ai-sdk/openai"`)]).toEqual(["ai-sdk"]);
    expect([...egressPrimitives("a.ts", `import type { AddressInfo } from "node:net"; /re/.exec("x")`)]).toEqual([]);
  });
});
