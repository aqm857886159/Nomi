// Agent lane · bash 的 OS 级沙箱。**照 pi 自带的 sandbox 示例接，不自研。**
//
// 用户 2026-09-07 原话：「沙箱机制它肯定有设计，权限设计里肯定有，直接把它抄过来应该就够了」。
// pi 的示例（`pi-coding-agent/examples/extensions/sandbox/index.ts`）用的是
// `@anthropic-ai/sandbox-runtime`（macOS `sandbox-exec` / Linux `bubblewrap` / Windows alpha），
// 这里接的就是同一个包、同一个 `BashOperations` 插槽——我们出的只有**策略**（allowWrite 是哪个
// 目录、denyRead 是哪些路径），执行一行都不写。
//
// ── 这里和 pi 示例的差别，以及每一处的领域理由 ──
//
//   · pi 示例把配置读自 `.pi/sandbox.json`（用户可编辑）。**我们不读任何用户可编辑的沙箱配置**：
//     Nomi 的用户是创作者，不是要调 seatbelt 策略的人；一个能被编辑的 `allowWrite` 等于把
//     「越界要问」这条闸留了一个纯文本后门。策略从项目根 derive，一处生成（`sandboxPolicyFor`）。
//   · pi 示例整个替换内建 `bash` 工具；我们只换 `operations`（`BashToolOptions.operations`，
//     `core/tools/bash.d.ts:56-68`），pi 的 schema、截断、渲染、system-prompt 贡献全部留着。
//   · pi 示例把超时按秒传给 `setTimeout`；我们把它接到 3c 契约的 `execution.timeoutMs`。
//   · 平台不支持时 pi 示例只 `notify` 一声继续跑**没有沙箱的 bash**；我们把这件事变成
//     `active:false` 交给策略层——第 ① 档（自动放行）整档消失、全部落回要人点头
//     （`codingCommandPolicy.ts` 头部：这一档的全部理由就是「在沙箱里」）。
//
// ── 为什么 Windows 上不假装有沙箱 ──
//
// 0.0.75 的 Windows 支持是 **alpha**，且要一次**提权**的 `npx @anthropic-ai/sandbox-runtime
// windows-install`（建 `srt-sandbox` 本地账户 + 装 WFP 出网过滤器）。我们不会替用户提权，
// 所以那台机器上 `active` 就是 `false`，UI 明标「此平台无系统级沙箱」。R29 文档 §5 有实核表。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { asarUnpackedJoin } from '../shared/asarUnpackedPath.js';
import type { LaneSandboxInactiveCode } from '../shared/agentLane/laneContracts.js';

/** pi 的 `BashOperations` 结构镜像（只镜像我们要实现的那一个方法，不 import 它的类型进 CJS 侧）。 */
export interface LaneBashOperations {
  exec(
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void
      signal?: AbortSignal
      timeout?: number
      env?: NodeJS.ProcessEnv
    },
  ): Promise<{ exitCode: number | null }>
}

export interface LaneSandboxPolicy {
  /** 唯一可写的地方 = 项目目录（外加临时目录，编译器/打包器要用）。 */
  readonly allowWrite: readonly string[]
  /** 读也不给的路径。第一道在 OS 层，第二道在 `codingCommandPolicy` 的硬清单（两层失效原因不同）。 */
  readonly denyRead: readonly string[]
  /** 写不给的路径，即使它落在 allowWrite 里面。 */
  readonly denyWrite: readonly string[]
  /** 允许出网的域名。**默认空 = 全拒**；技能声明的域名进来之后仍然要过 `codingCommandPolicy` 的确认。 */
  readonly allowedDomains: readonly string[]
}

/**
 * 沙箱没起来时，「为什么」分成两半：**给用户看的码** 和 **给排错看的正文**。
 *
 * 分开是因为它们的读者和寿命都不同。`code` 是产品契约——界面按它挑一句中文/英文
 * （`agentPanelV4.sandboxInactive*`），上游换个措辞不会让那句话跟着变。`detail` 是这一刻的
 * 诊断（平台名、上游异常正文），只进主进程日志：把它直接印到面板上，就是把
 * `Sandbox initialization failed: EACCES …` 丢给一个正在做视频的人看。
 */
export interface LaneSandboxInactive {
  readonly code: LaneSandboxInactiveCode
  /** 排错正文。**只进日志，不进界面**。 */
  readonly detail: string
}

export interface LaneSandbox {
  /** 这一刻沙箱是不是真在生效。策略层拿它决定第 ① 档存不存在。 */
  readonly active: boolean
  /** 不 active 时的原因。见 `LaneSandboxInactive`。 */
  readonly inactive?: LaneSandboxInactive
  /** 交给 `createBashTool(cwd, { operations })` 的那个插槽。 */
  readonly operations: LaneBashOperations
  close(): Promise<void>
}

/**
 * 策略从项目根 derive，**一处生成**。
 *
 * `denyRead` 的三族：用户的密钥（SSH/云/GPG/npm/pypi/k8s）、Nomi 自己的设置与密钥存储、
 * 以及 pi 的会话目录（转录里有用户原稿，模型不该经由 shell 再读一遍自己的上下文）。
 */
export function sandboxPolicyFor(input: {
  projectDir: string
  settingsRoot: string
  allowedDomains?: readonly string[]
}): LaneSandboxPolicy {
  const projectDir = path.resolve(input.projectDir);
  return {
    allowWrite: [projectDir, '/tmp'],
    denyRead: [
      '~/.ssh', '~/.aws', '~/.gnupg', '~/.netrc', '~/.npmrc', '~/.pypirc',
      '~/.config/gcloud', '~/.kube', '~/.docker/config.json',
      path.resolve(input.settingsRoot),
    ],
    // `.env` 与私钥即使在项目里也不许写——覆盖它们是「悄悄换掉一个凭据」，
    // 而那件事没有任何创作理由（形状照 pi 示例的 `denyWrite`，清单是我们的）。
    denyWrite: ['.env', '.env.*', '*.pem', '*.key', '.git/config', '.git/hooks'],
    allowedDomains: input.allowedDomains ?? [],
  };
}

/** `SandboxManager` 的最小结构面。写成接口是为了让单测能喂一个假的，而不必真起 seatbelt。 */
export interface SandboxManagerLike {
  isSupportedPlatform(): boolean
  initialize(config: unknown): Promise<void>
  wrapWithSandbox(command: string): Promise<string>
  reset(): Promise<void>
}

/**
 * 沙箱运行时交给**别的进程**的那几个文件，在打包后的真实路径。
 *
 * ── 为什么必须我们来给 ──
 *
 * 运行时自己找这些文件的办法是 `dirname(fileURLToPath(import.meta.url))` 再往上拼
 * `vendor/...`（`dist/sandbox/generate-seccomp-filter.js` 的 `getLocalSeccompPaths`、
 * `java-proxy-agent.js` 的 `findJar`、`windows-sandbox-utils.js` 的 `repoRoot` 都是这一招）。
 * 打包后这个模块是从 `app.asar` 里加载的，于是 `import.meta.url` 指进归档，拼出来的
 * 也是归档里的路径——**哪怕 `asarUnpack` 已经把真文件摊到了 `app.asar.unpacked/`**。
 *
 * 这就是本条最反直觉的地方，也是 2026-09-12 那份教训的正文：`asarUnpack` 只保证
 * 「盘上有一份真的」，它**不改**任何人手里已经拿着的字符串。Electron 只给自己进程的 `fs`
 * 打了补丁，所以运行时那句 `existsSync(归档里的路径)` 回 `true`、当场认定找到了、
 * 不再往后试别的候选——然后把这个路径 `spawn` 出去，内核回 `ENOTDIR`。
 * 实测见 `docs/lessons/2026-09-12-sandbox-runtime-not-unpacked.md`。
 *
 * 所以 0.0.75 开的那三个显式入口（`seccomp.applyPath` / `javaAgentJarPath` /
 * `windows.srtWin.path`，见 `dist/sandbox/sandbox-config.d.ts`）不是备选项，是**唯一**
 * 能让打包后的 app 用上这些二进制的路。给它们是 R29 意义上的「用框架给的接口」，
 * 不是绕过框架。
 *
 * ── 为什么按平台给 ──
 *
 * 每个文件只在它那个平台上会被执行：`apply-seccomp` 是 Linux 的，`srt-win.exe` 是
 * Windows 的。全都无条件塞进去，等于在 macOS 上声明一个这辈子不会被打开的路径——
 * 配置里多一个无效字段，下次排错的人就要多排除一个。jar 没有平台条件：
 * 沙箱里跑 JVM 这件事三个平台都可能发生。
 *
 * 开发态（没打包）时 `asarUnpackedPath` 是恒等变换，算出来的就是运行时自己也会找到的那条路，
 * 所以开发和打包跑的是**同一条代码路径**——这正是这个 bug 当初能活到打包才暴露的原因。
 */
export function laneSandboxVendorPaths(
  deps: { resolvePackageJson: () => string; exists: (candidate: string) => boolean; platform: string; arch: string },
): { seccomp?: { applyPath: string }; javaAgentJarPath?: string; windows?: { srtWin: { path: string } } } {
  let vendorRoot: string;
  try {
    // 包根 = `package.json` 的目录；`require.resolve` 解开 pnpm 的符号链接，拿到真实落盘处。
    vendorRoot = path.join(path.dirname(deps.resolvePackageJson()), 'vendor');
  } catch {
    // 解析不到就一个字段都不给，让运行时按自己的办法找。这里不是 fail-closed 的地方：
    // 沙箱起不起得来由 `initialize` 自己回答，这个函数只负责「能指路就指准」。
    return {};
  }
  const usable = (...segments: string[]): string | undefined => {
    const candidate = asarUnpackedJoin(vendorRoot, ...segments);
    return deps.exists(candidate) ? candidate : undefined;
  };
  const result: { seccomp?: { applyPath: string }; javaAgentJarPath?: string; windows?: { srtWin: { path: string } } } = {};
  const jar = usable('java-proxy-agent', 'srt-proxy-agent.jar');
  if (jar) result.javaAgentJarPath = jar;
  if (deps.platform === 'linux') {
    const applyPath = usable('seccomp', deps.arch, 'apply-seccomp');
    if (applyPath) result.seccomp = { applyPath };
  }
  if (deps.platform === 'win32') {
    const srtWin = usable('srt-win', deps.arch, 'srt-win.exe');
    if (srtWin) result.windows = { srtWin: { path: srtWin } };
  }
  return result;
}

const defaultVendorDeps = () => ({
  resolvePackageJson: () => createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/package.json'),
  exists: (candidate: string) => existsSync(candidate),
  platform: process.platform as string,
  arch: process.arch as string,
});

/**
 * 起一个沙箱。**失败不抛**——它返回一个 `active:false` 的沙箱。
 *
 * 为什么不抛：抛出去的后果是整条 lane 开不起来，于是「这台机器没有沙箱」这件事的症状是
 * 「Agent 坏了」。而正确的产品行为是「Agent 能用，只是每条命令都要你点一下，并且明着告诉你为什么」
 * （D4：缺口明着标，不藏不糊弄）。fail-closed 落在**策略层**，不落在装配层。
 */
export async function openLaneSandbox(
  policy: LaneSandboxPolicy,
  deps: {
    manager: SandboxManagerLike
    localOperations: LaneBashOperations
    /** 只有测试会传——生产走 `defaultVendorDeps()`（真 require.resolve + 真 fs）。 */
    vendor?: Parameters<typeof laneSandboxVendorPaths>[0]
  },
): Promise<LaneSandbox> {
  if (!deps.manager.isSupportedPlatform()) {
    return inactive(deps.localOperations, 'unsupported-platform', `No OS-level sandbox on ${process.platform}.`);
  }
  try {
    await deps.manager.initialize({
      network: { allowedDomains: [...policy.allowedDomains], deniedDomains: [] },
      filesystem: {
        denyRead: [...policy.denyRead],
        allowWrite: [...policy.allowWrite],
        denyWrite: [...policy.denyWrite],
      },
      // 打包后这几个字段是「二进制找得到」和「找不到」的分界线，见 `laneSandboxVendorPaths` 头部。
      ...laneSandboxVendorPaths(deps.vendor ?? defaultVendorDeps()),
    });
  } catch (cause) {
    return inactive(deps.localOperations, 'init-failed',
      `Sandbox initialization failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return {
    active: true,
    operations: sandboxedOperations(deps.manager),
    close: async () => { await deps.manager.reset().catch(() => undefined); },
  };
}

function inactive(localOperations: LaneBashOperations, code: LaneSandboxInactiveCode, detail: string): LaneSandbox {
  return {
    active: false,
    inactive: { code, detail },
    // 仍然给 operations：`active:false` 不等于「不能跑命令」，等于「每条都要人点头」。
    // 没有沙箱又不许跑，这台机器上的技能脚本就一条都用不了——那是把缺口变成了功能缺失。
    operations: localOperations,
    close: async () => undefined,
  };
}

/**
 * pi 示例那段 `createSandboxedBashOps` 的等价物。
 *
 * 逐行对照过示例（`examples/extensions/sandbox/index.ts` 的同名函数），只改了三处：
 *   · 超时按**毫秒**收（我们的契约是 `execution.timeoutMs`），进 `setTimeout` 前不再乘 1000；
 *   · `env` 由调用方给（`spawnHook` 已经把 key 类变量摘干净了），不再原样继承 `process.env`；
 *   · 超时/中止的 `reject` 正文改成模型能自纠的一句话，不是 `timeout:30`。
 */
function sandboxedOperations(manager: SandboxManagerLike): LaneBashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout, env }) {
      const wrapped = await manager.wrapWithSandbox(command);
      return await new Promise((resolve, reject) => {
        const child = spawn('bash', ['-c', wrapped], {
          cwd,
          // `detached` 是为了拿到进程**组**——超时要杀的是整棵树，不是那一个 bash。
          // 少了它，`node build.js` 会在 bash 被杀之后继续跑（pi 示例同样这么做）。
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          ...(env ? { env } : {}),
        });
        let timedOut = false;
        const killTree = () => {
          if (!child.pid) return;
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        };
        const timer = timeout && timeout > 0
          ? setTimeout(() => { timedOut = true; killTree(); }, timeout)
          : undefined;
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
        signal?.addEventListener('abort', killTree, { once: true });
        child.on('close', (code) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', killTree);
          if (signal?.aborted) { reject(new Error('The command was cancelled.')); return; }
          if (timedOut) {
            reject(new Error(
              `The command was killed after ${timeout} ms. Split it into smaller steps, or run the long part `
              + 'in the background and check its output file with a second command.'));
            return;
          }
          resolve({ exitCode: code });
        });
      });
    },
  };
}
