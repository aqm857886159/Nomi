// 「现在能不能立刻重启安装」只由主进程这一处判断：不打断任何还在干活的东西。
//
// 主进程自己知道的（任务缓存、制作流程 Run、导出）全部走 backgroundLaunch 里已有的
// `hasInFlightProductionWork` 这一个 owner，不另数一份。主进程看不到的只有画布里排队 / 生成中、
// 还没落到主进程的节点——渲染层把它们的个数报上来（只报事实，不参与判断）。
// 判不准就拦：请求安装的那个窗口没报过数，当作忙；读主进程状态抛错，当作忙。
export type UpdateBusyGate = {
  /** 渲染层报告它那边还有几个排队 / 生成中 / 导出中的任务。窗口销毁时由调用方 forget。 */
  report(senderId: number, count: number): void;
  forget(senderId: number): void;
  /** 立即重启安装前问：true = 有活在干，不许打断。 */
  isBusyForInstall(senderId: number): boolean;
  /** 退出时安装前问：窗口此时已关，只看主进程自己的活和仍在册的报告。 */
  isBusyAtQuit(): boolean;
};

export function createUpdateBusyGate(deps: { hasMainBusy: () => boolean }): UpdateBusyGate {
  const reported = new Map<number, number>();
  const mainBusy = (): boolean => {
    try {
      return deps.hasMainBusy();
    } catch {
      return true;
    }
  };
  const rendererBusy = (): boolean => [...reported.values()].some((count) => count > 0);
  return {
    report(senderId, count) {
      reported.set(senderId, Number.isFinite(count) && count > 0 ? Math.floor(count) : 0);
    },
    forget(senderId) {
      reported.delete(senderId);
    },
    isBusyForInstall(senderId) {
      return !reported.has(senderId) || rendererBusy() || mainBusy();
    },
    isBusyAtQuit() {
      return rendererBusy() || mainBusy();
    },
  };
}
