/**
 * 模块级后台任务的「还有几件在跑」探针登记表。
 *
 * 为什么有它（2026-10-10，exportJobIpc 负载下连红 10 条）：模块级单例（导出任务表这类）在同一个测试文件的
 * 用例之间共享。一个用例超时被放弃后，它启动的任务仍在后台跑完、留在单例里；下一个用例在同一个项目上
 * 建任务就被「已有导出在进行」拒绝——一处泄漏把后面全部拖红，报错还指向无辜的用例。
 *
 * 单例在模块初始化时登记一个探针（count：还在跑的件数；settle：把它们收尾）。共享测试 setup
 * （tests/setup/inflightWork.ts）在**每个用例结束后**核一遍：有残留就收尾并让这个用例红，报出是哪张表。
 * 登记表挂在 globalThis 上（Symbol.for 取同一把钥匙），setup 不必 import 任何生产模块，没加载单例的测试零成本。
 * 生产里没人读它；登记只是往一张 Map 里放两个函数。
 */
export type InflightProbe = Readonly<{
  /** 现在还有几件后台任务没有落定。 */
  count: () => number;
  /** 把还没落定的任务收尾（取消 / 中止）；尽力而为，不抛。 */
  settle: () => Promise<void>;
}>;

export const INFLIGHT_PROBES_KEY = Symbol.for("nomi.inflightProbes");

type ProbeHost = { [INFLIGHT_PROBES_KEY]?: Map<string, InflightProbe> };

export function registerInflightProbe(name: string, probe: InflightProbe): void {
  const host = globalThis as ProbeHost;
  if (!host[INFLIGHT_PROBES_KEY]) host[INFLIGHT_PROBES_KEY] = new Map();
  host[INFLIGHT_PROBES_KEY].set(name, probe);
}
