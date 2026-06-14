// 让纯 node 评测脚本的 fetch 走系统代理。Node 原生 fetch(undici)默认**不读** HTTP(S)_PROXY 环境变量,
// 而用户机器常挂 Clash 类代理(curl 读环境变量能通、node fetch 直连被墙超时)。import 即生效(一次性设全局
// dispatcher)。无代理或无 undici 则降级直连,不报错。judge.mjs import 它 → vbenchRubric/review-images 经
// judge 传递性覆盖(全局 dispatcher 一处生效全局通)。
try {
  const proxy =
    process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (proxy) {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(proxy));
  }
} catch {
  /* 无 undici / 无代理 → 直连 */
}
