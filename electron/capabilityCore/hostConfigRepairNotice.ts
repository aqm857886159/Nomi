// 「Nomi 已经把你的助手接入配置修回来了，去重启它」——这句提示从主进程送到主窗口的那一小段线。
//
// 为什么单独成一个文件而不是写在 main.ts 里：main.ts 是登记在册的巨壳（check:filesize 的基线只减不增），
// 每根新线都往里塞，最后没人能读完它。这里也不只是「腾地方」——搬出来之后这段逻辑才**能被真单测覆盖**：
// main.ts 在 vitest 里起不来（它一 import 就要 Electron app），于是它里面的东西过去只能靠「读源码字符串」
// 断言，那种断言在上一次重写回调形状时就失效了一次（R28：防线建在最早能拦住的那层）。
//
// 「要不要提示」不在这里判：那是能力核的事（appIntegration 只在 repair.changed 时才调用本函数），
// 这里只负责把「该重启谁」原样递给渲染层，由它的 i18n 决定说成什么话。
import { requestRenderer } from './rendererBridge'

/** 渲染层等这一条的最长时间：窗口刚建好、桥还没接上的那几秒要等得起。 */
const RENDERER_DEADLINE_MS = 30_000

export async function notifyHostConfigRepaired({ clientLabels }: { clientLabels: readonly string[] }): Promise<void> {
  if (!clientLabels.length) return
  try {
    await requestRenderer('host-config.repaired', { clients: [...clientLabels] }, RENDERER_DEADLINE_MS)
  } catch {
    // 没人接（窗口还没起来 / 已经关了）不能反向拖垮能力核启动。配置本身已经修好了，
    // 用户最坏的情况是自己重启助手时才发现它又能用了——比启动被一句提示卡住好。
  }
}
