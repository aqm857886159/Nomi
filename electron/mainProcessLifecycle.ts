import {
  installCrashHandlers,
  installProcessGoneHandlers,
  installUncaughtExceptionNoiseFilter,
  startNativeCrashCapture,
} from "./crashLog";
import { installMainLogger, markStderrAsDiagnosticSurface } from "./logging/logger";
import { installParentProcessWatchdog } from "./parentProcessWatchdog";
import { installProcessStdioErrorGuards } from "./processStdio";

type ElectronAppLifecycle = {
  readonly isPackaged: boolean;
  exit: (code?: number) => void;
  once: (event: "before-quit", listener: () => void) => unknown;
};

type MainProcessLifecycleDependencies = {
  env?: NodeJS.ProcessEnv;
  installCrashHandlers?: typeof installCrashHandlers;
  installUncaughtExceptionNoiseFilter?: typeof installUncaughtExceptionNoiseFilter;
  installProcessGoneHandlers?: typeof installProcessGoneHandlers;
  startNativeCrashCapture?: typeof startNativeCrashCapture;
  installParentProcessWatchdog?: typeof installParentProcessWatchdog;
  installProcessStdioErrorGuards?: typeof installProcessStdioErrorGuards;
  installMainLogger?: typeof installMainLogger;
  markStderrAsDiagnosticSurface?: typeof markStderrAsDiagnosticSurface;
};

function readLauncherPid(env: NodeJS.ProcessEnv): number | undefined {
  const launcherPid = Number(env.NOMI_LAUNCHER_PID);
  return Number.isInteger(launcherPid) && launcherPid > 1 ? launcherPid : undefined;
}

export function installMainProcessLifecycle(
  app: ElectronAppLifecycle,
  dependencies: MainProcessLifecycleDependencies = {},
): void {
  const crashHandlerInstaller = dependencies.installCrashHandlers ?? installCrashHandlers;
  const watchdogInstaller =
    dependencies.installParentProcessWatchdog ?? installParentProcessWatchdog;
  const stdioGuardInstaller =
    dependencies.installProcessStdioErrorGuards ?? installProcessStdioErrorGuards;
  const processGoneInstaller =
    dependencies.installProcessGoneHandlers ?? installProcessGoneHandlers;
  const nativeCrashCaptureStarter =
    dependencies.startNativeCrashCapture ?? startNativeCrashCapture;
  const noiseFilterInstaller =
    dependencies.installUncaughtExceptionNoiseFilter ?? installUncaughtExceptionNoiseFilter;
  const mainLoggerInstaller = dependencies.installMainLogger ?? installMainLogger;
  const hostSurfaceMarker =
    dependencies.markStderrAsDiagnosticSurface ?? markStderrAsDiagnosticSurface;
  stdioGuardInstaller();
  // MCP stdio 进程（NOMI_MCP_STDIO=1）的 stderr 不是开发者的终端，而是**宿主协议面**：
  // stdout 整条让给了 JSON-RPC，宿主（Claude Code / Codex）唯一看得见我们诊断的地方就是它，
  // 打包版尤其——那正是真实宿主拉起我们的形态。所以这个进程里日志必须无条件镜像过去。
  // 必须排在 mainLoggerInstaller 之前：会话表头是第一行日志，晚一步它就只落盘、进不了宿主视野，
  // 而「这次到底起没起来、是哪个构建」正是宿主排查时要看的第一行。
  if ((dependencies.env ?? process.env).NOMI_MCP_STDIO === "1") hostSurfaceMarker();
  // 排在崩溃处理之前：日志的第一行就是会话表头（版本/平台/pid）。启动早期崩掉时，
  // 「这次会话到底起没起来、是哪个构建」全靠它——晚装一步就正好丢掉最该有的那一行。
  mainLoggerInstaller();
  crashHandlerInstaller();
  // 装在 crashHandlerInstaller 之后：uncaughtExceptionMonitor 与 uncaughtException 是两条独立通道，
  // monitor 永远先跑、永远落盘（留证不受影响），这条只决定「要不要弹那个原生崩溃框」。
  noiseFilterInstaller();
  // Crashpad 必须在 app ready 前装（本函数由 main.ts 顶层调用），否则原生崩溃拿不到 minidump。
  nativeCrashCaptureStarter();
  // 不传 target：进程死亡事件挂在 Electron 的 app 上（覆盖所有窗口，含辅助窗），由 crashLog 自己绑。
  processGoneInstaller();
  const stopParentProcessWatchdog = watchdogInstaller({
    // 正装由操作系统管理；只有开发/测试实例应跟随临时启动器退出。
    enabled: !app.isPackaged,
    // 启动器可能在 Electron 完成模块加载前已被强杀；此时 process.ppid 已经变成 1。
    // 显式传入 spawn 时的 PID，才能封住这段启动竞态。
    parentPid: readLauncherPid(dependencies.env ?? process.env),
    exit: (code) => app.exit(code),
  });
  app.once("before-quit", stopParentProcessWatchdog);
}
