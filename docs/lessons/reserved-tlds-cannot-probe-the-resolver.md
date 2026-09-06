# 探测本机解析器要用真实 TLD，`.invalid` / `.test` 探不到代理

> 📎 教训 · 首次记录 2026-09-07 · 状态：现行
> **触发场景**：要写一个「这台机器的 DNS 是不是被本地代理接管了 / 是不是在合成答案」的探针时；或读到任何用 RFC 保留域名（`.invalid` `.test` `.example` `.localhost`）当阳性对照的代码时。

**结论**：探针要用**随机标签 + 真实 TLD**（`nomi-fakeip-probe-<random>.com`）。RFC 2606/6761 那些「保证不存在」的保留 TLD **当不了探针**——解析器按规范**就地**把它们答成 NXDOMAIN，查询根本不出门，于是在一台确实开着 fake-ip 代理的机器上，探针也恒返回 ENOTFOUND，整个基于它的判断静默失效。

**为什么会踩**：

修 SSRF 门岗在 fake-ip 代理下拦掉取片的问题时（`electron/networkOutboundPolicy.ts`），放行 `198.18.0.0/15` 必须有**阳性证据**：证明本机解析器在合成答案，而不是「用户可能开了代理」就默认放行。当时的推理链条看起来无懈可击：

> `.invalid` 由 RFC 2606 §2 保证永不存在 → 正常解析器必答 NXDOMAIN → 只有在合成答案的解析器才会给出地址 → 完美的阳性对照。

单测全绿（20/20，还做了变异测试，两个 mutant 都被抓住）。**但那些测试注入的是 DNS 夹具，验的是判据，不是探针本身能不能在真机上取到证据。**

真机实测（用户机器，Clash TUN + fake-ip 确实开着，`api.apimart.ai → 198.18.0.140`）：

```
nomi-fakeip-probe-74rf3q9vwd.com     -> 198.18.2.228   ✅ 代理答的，证据成立
nomi-fakeip-probe-2xcw16ci3b.net     -> 198.18.2.229   ✅
nomi-fakeip-probe-gqortvorri.invalid -> ENOTFOUND      ❌ 系统本地答的
nomi-fakeip-probe-6md3vt5xmq.test    -> ENOTFOUND      ❌
nomi-fakeip-probe-6tt2saelif.example -> ENOTFOUND      ❌
nomi-fakeip-probe-tn1wp9ylpe.local   -> ENOTFOUND（5s 超时）❌
```

机制：RFC 6761 明确要求解析器**在本地**处理这些特殊用途域名，不得向上游转发。macOS 的 mDNSResponder 照做了。也就是说，这些名字**恰恰因为太规范而无法当探针**——它们规范到根本不出门，探不到代理那一层。

这个 fix 差一点就带着「测试全绿、真机全无效果」上线：它会在用户机器上永远判定「没有本地代理」，于是维持拦截，于是取片照旧失败，而所有单测继续绿着。

**怎么用**：

- 写「探本机网络环境」的探针，第一件事是**在真机上打印探针的原始返回**，别只跑注入夹具的单测。判据的测试和探针的测试是两件事，前者绿不代表后者能取到证据（同 `vacuous-probe-passes-forever.md` 一族：探针测不到它命名的那件事）。
- 需要「保证不存在的域名」时用**随机标签 + 真实 TLD**。10 个随机字符撞上真实注册域名的概率可忽略；即便撞上，真实域名解析出的是公网地址，落不进合成池，不会造成误判。
- 查多个 TLD（本仓用 `.com` + `.net`），容忍单个 TLD 的解析异常，任一给出合成地址即判定成立。
- 反过来记住：`.local` 会走 mDNS，可能**阻塞 5 秒**（上表实测）。任何探针都要带超时，且失败必须 fail-closed。

**出处**：`electron/networkOutboundPolicy.ts`（`PROBE_TLDS` 与文件头实测表）、`electron/networkOutboundPolicy.test.ts`（「探针只用真实 TLD」那条断言守住这次回归）、`docs/fixes/2026-09-07-outbound-policy-split-across-submit-and-retrieval.root-cause.json`、RFC 6761 §6.3-6.4。
