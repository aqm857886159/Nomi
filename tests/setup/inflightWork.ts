/**
 * 每个用例结束后核一遍：模块级单例（导出任务表等，见 electron/inflightProbe.ts）里不许留着没落定的后台任务。
 * 由 `vitest.config.ts` 的 `setupFiles` 挂上，所有默认车道的测试自动生效，不靠每个测试文件记得收尾。
 *
 * 有残留时：先把它们收尾（不让它拖红后面的用例），再让**这个**用例红，报出是哪张表、几件。
 * 2026-10-10 的实证：exportJobIpc 第一个用例在负载下超时被放弃，它建的导出任务留在单例里，
 * 后面 9 个用例全报「已有导出在进行」——报错指着无辜的用例，真正的泄漏点看不见。
 *
 * 只读 globalThis 上的登记表，不 import 任何生产模块：没加载这些单例的测试零成本。
 */
import { afterEach } from "vitest";

type InflightProbe = { count: () => number; settle: () => Promise<void> };

afterEach(async () => {
  const probes = (globalThis as Record<symbol, Map<string, InflightProbe> | undefined>)[Symbol.for("nomi.inflightProbes")];
  if (!probes) return;
  const leaks: string[] = [];
  for (const [name, probe] of probes) {
    const count = probe.count();
    if (count === 0) continue;
    leaks.push(`${name}=${count}`);
    await probe.settle();
  }
  if (leaks.length > 0) {
    throw new Error(
      `用例结束时还有后台任务没落定：${leaks.join("、")}。用例要自己 await 完或取消它启动的任务；`
      + "否则它会在下一个用例里冒出来（跨用例泄漏）。已替它收尾，后面的用例不受影响。",
    );
  }
});
