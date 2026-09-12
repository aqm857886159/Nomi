/**
 * 主进程把「接入会话服务」装配起来的那一处，也是它唯一的装配处。
 *
 * 为什么单独一个文件：三样运行时能力（真实 runTask / fetchTaskResult / 付费令牌）
 * 是 ComfyUI 认证的**必需依赖**，而不是可选增强。2026-09-11 的真机矩阵实锤：
 * `registerIntegrationSessionIpc()` 不传 service → 单例零参构造 → 三样全 undefined
 * → 导入的工作流永远晋级不了 → ComfyUI 实例永远「未启用」→ 画布上零个 ComfyUI 模型。
 * 把装配收在这里，每个进程入口就只剩一条路可走（R28：防线建在最早能拦住的那层）。
 *
 * **Nomi 有三个会用到它的主进程入口**，三个都必须装，缺一个那个进程就整条接入链不可用：
 *   1. GUI（electron/main.ts 的 registerIpc）
 *   2. 打包的 MCP stdio server（electron/capabilityCore/mcpStdioServer.ts）——headless 时
 *      凭据页是密钥的唯一入口，它内部就取这个服务
 *   3. 一次性 CLI host（electron/capabilityCore/host.ts）——dispatch 的 integration.* 全经过它
 * 这条「三个入口都要装」由 integrationSessionRuntimeInstall.test.ts 的结构断言守着。
 *
 * 根因合同：docs/fixes/2026-09-11-comfyui-certification-wiring.root-cause.json
 */
import { mintSpendGrant } from "../spendGrant";
import type { ComfyCertificationRuntime } from "./types";
import {
  createRuntimeIntegrationSessionService,
  installRuntimeIntegrationSessionService,
  type IntegrationSessionService,
} from "./integrationSession";

// runtime.ts 很重（模型目录、供应商适配、导出链），装配期不该为了接线把它整个拉进来。
// ESM 模块注册表本身就去重，所以这里和别处各自 import() 拿到的是同一个模块实例。
let runtimeModulePromise: Promise<typeof import("../runtime")> | null = null;
function loadRuntimeModule(): Promise<typeof import("../runtime")> {
  runtimeModulePromise ??= import("../runtime");
  return runtimeModulePromise;
}

/** 交给认证服务的那三样真东西。单独导出是为了能被断言到（缺一样就是 BUG-2 复发）。 */
export function integrationSessionRuntimeDependencies(): ComfyCertificationRuntime {
  return {
    runTask: async (payload) => (await loadRuntimeModule()).runTask(payload),
    fetchTaskResult: async (payload) => (await loadRuntimeModule()).fetchTaskResult(payload),
    // 令牌只覆盖本次认证那一个合成节点、只允许一次尝试。ComfyUI 认证会真的跑一次本机
    // 工作流，所以这一颗额度令牌仍然要铸；HTTP 供应商那条路的自检不发生成请求。
    mintSpendGrant: (nodeIds, maxAttemptsPerNode) =>
      mintSpendGrant({ nodeIds, ...(maxAttemptsPerNode ? { maxAttemptsPerNode } : {}) }),
  };
}

/** 启动期装配本进程内唯一实例；RPC、stdio、CLI host 与可信 UI IPC 之后拿到的都是这一个。 */
export function installIntegrationSessionRuntime(): IntegrationSessionService {
  return installRuntimeIntegrationSessionService(
    createRuntimeIntegrationSessionService(integrationSessionRuntimeDependencies()),
  );
}
