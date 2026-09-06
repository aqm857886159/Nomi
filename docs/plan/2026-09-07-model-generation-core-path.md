# 生成主干道：出站策略单一 owner + 已付费不重复扣费

> 状态：🚧 本分支（`fix/model-generation-core-path-20260907`）交付第一批；尾巴清单见文末「未做」。
> 根因合同：[`docs/fixes/2026-09-07-outbound-policy-split-across-submit-and-retrieval.root-cause.json`](../fixes/2026-09-07-outbound-policy-split-across-submit-and-retrieval.root-cause.json)、
> [`docs/fixes/2026-09-07-relay-catalog-listing-is-not-liveness.root-cause.json`](../fixes/2026-09-07-relay-catalog-listing-is-not-liveness.root-cause.json)

## 这件事到底是什么（大白话）

用户开着 Clash/Surge 这类本地代理（TUN + fake-ip 模式）跑了 10 条视频。**钱扣了，一帧也没拿回来**，
界面只说「生成失败」。

为什么：fake-ip 代理会把每个域名都解析成一个**假地址**（`198.18.x.x` 这一段），真正的 DNS 由代理
自己在那侧做。而 Nomi 的两条出站路径**各判各的**——

| | 走谁 | 对目的地的检查 |
|---|---|---|
| 提交任务 / 轮询（**花钱的那一步**） | `vendorHttp → appFetch` | 零检查，信任用户填的 vendor 地址 |
| 取回产物（**拿到东西的那一步**） | `hardenedFetch` | 解析 DNS + 私网分类，**可以拒绝** |

于是有了一个致命的不对称：**我们愿意为之付钱的目的地，可能是我们拒绝读取的目的地**。
`198.18.x` 被当成内网给拦了，POST 放行、GET 被自己拦下。

这不是「黑名单多了一段」，所以不能靠「把 198.18 加进白名单」了事——那是修症状。类根因是
**同一次生成的出站决策被判了两次**。

## 先查别人

在写 `networkOutboundPolicy.ts` 之前实际检索的结果（R27 派工纪律；结论写在每条末尾）：

- **依赖里已有？** 没有第三方 IP 段分类库可用，也不需要装：`ls node_modules | grep -E '^(ipaddr|ip-address|netmask|private-ip|cidr)'` 空结果，而 Node 自带的 `net.BlockList` 已经能做 CIDR 归属判定，仓库里[已经在用它](../../electron/networkHostPolicy.ts)（`electron/networkHostPolicy.ts:3`）。**结论：用已有的 `node:net`，不引新依赖。**
- **仓库里已有？** 私网判据已经有 owner——`electron/hardenedFetch.ts:100` 调 `isPrivateHost`，共 7 个引用点（`git grep -n isPrivateHost -- electron`）。所以本轮**不是新写一个分类器**，而是把判据收进 `classifyOutboundAddresses` 并用 `check:outbound-policy` 棘轮盯住这 7 个点 + 22 个 `appFetch` 引用点，谁再长第二个就报红。**结论：扩已有边界，不另起炉灶。**
- **生态里已有（同一个 bug 别人怎么修的）？** 同一族问题在别的项目上真实发生过：<https://github.com/openclaw/openclaw/issues/25215> —— 一次 SSRF 收紧把 `198.18.0.0/15` 拉黑，Clash/mihomo 用户的 `web_fetch` 全挂。那边提的三条方案**全是加开关**（`ssrfPolicy.allowPrivateNetwork` 参数 / 全局配置 / 干脆别拦这一段）。**结论：反着做。** 加开关等于把「安不安全」变成用户的作业，而且开关一开连 `169.254`（云元数据）一起放行。我们要的是**阳性证据**：探到本机解析器确实在合成答案，才放行这一段，探不到就维持拦截（fail-closed）。
- **一手规范怎么说？** `198.18.0.0/15` 由 RFC 2544 §C.2.2 分配给网络设备基准测试（<https://datatracker.ietf.org/doc/html/rfc2544>），RFC 6890 列为特殊用途保留段——**它不是 RFC 1918 私网**，真实内网服务不该住在那里；而 Clash/mihomo 的 `fake-ip-range` 默认正是 `198.18.0.1/16`（<https://wiki.metacubex.one/en/config/dns/>，已实抓确认示例配置写的就是这个值）。**结论：这一段可以在有证据时区别对待，其余私网段一条都不放。**
- **踩到的反直觉坑（新沉淀）** 探针域名**不能**用 `.invalid`/`.test`/`.example`：RFC 6761 要求解析器在本地直接答 NXDOMAIN，查询根本到不了代理，探测必然失败。实测记录见 [`docs/lessons/reserved-tlds-cannot-probe-the-resolver.md`](../lessons/reserved-tlds-cannot-probe-the-resolver.md)。**结论：用随机 `.com`/`.net` 标签。**

## 做了什么

1. **出站判据收成一处** —— `electron/networkOutboundPolicy.ts` 是唯一分类器（`classifyOutboundAddresses`）+ 唯一环境事实（`readOutboundEnvironment`，进程内只探一次并缓存，提交那刻算出的环境取回时读到的是同一份）。`scripts/check-outbound-policy.mjs` 棘轮盯住所有引用点。
2. **fake-ip 凭阳性证据放行** —— 随机 `.com` 探针答出 `198.18/15` 才认定代理在合成地址；`127/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16` 一条不放。探测失败/超时 → 当作没有代理，维持拦截。
3. **删逃生口** —— `LAB_ALLOW_LOCALHOST=1`（把分类器整个关掉，连元数据段一起放行）已删除，换成 `setLabTrustedPrivateOrigins` 精确 origin 注入，打包版连读都不读。门岗对这个形状是**硬零**。
4. **错误说人话** —— 稳定机器码 `NOMI_ERR::outbound-blocked::` + 三段式文案（发生了什么 / 钱怎么样了 / 你现在该做什么），分类器认码不认中文（人话会被 i18n 换语言）。
5. **已付费的不再重复扣费** —— 出站被拦的节点落 `recoverable` 而不是 `error`，用户看到的是**免费**「重新拉取结果」，不是付费重试。这条最容易悄悄坏掉：文案和状态机住在两个模块里，谁都不认识谁，所以断言写在「按钮存在的前提」这一层（`src/workbench/generationCanvas/runner/outboundBlockedRecoverable.test.ts`，含阳性对照）。刹车方向也反过来钉住了：出站被拦**计入**刹车（后面每条都会同样失败，而提交侧照旧扣费，停下来才省钱），超时可找回**不计**。
6. **目录列表不是可用性证据** —— `deepseek-v3.2-think` 带鉴权实调两遍都是 HTTP 400「is not a valid model ID」→ 下架（curated 删行 + 进 `RETIRED_*`，否则存量安装每次启动插回来）。同批实探**推翻了派工前提的三分之二**：`deepseek-v3.2` 与 `deepseek-v3.1-terminus` 今天都还能用，**没动**。雷达新增 `apimart-llm` 泳道（此前 LLM 目录一眼没看过），确定性、零推理调用。

## 未做（诚实清单，不藏）

- **提交侧仍不调用 `networkOutboundPolicy`。** 本轮消灭的是「愿意付钱 ≠ 愿意读取」这个不对称，不是把两侧塞进同一个函数——提交侧信任的是用户显式填进模型设置的 vendor origin，与任务返回的链接不同源。反方向的不对称（提交目的地本身敌意）登记在合同 `residual_risks`。
- **`hardenedFetch` 在显式应用代理生效时整段跳过目的地分类**，此时策略 owner 是被绕过而不是被咨询。本轮真正走到新判据的是 TUN/fake-ip（没有可见代理）那条。
- **退役模型的自动探测没做。** 雷达只 diff **列表**，而 `deepseek-v3.2-think` 恰恰是「列表里还在、实调已死」——真正的判据是带鉴权的最小 `/v1/chat/completions`，这次是手工两轮验收。自动化需要一份零额度夹具，见下条。
- **零额度夹具没进 gates。** `tests/ux/outbound-policy-paid-retrieval.e2e.mjs` 是手工付费验收（`APIMART_E2E=1` 才跑），没有任何 package.json 脚本引它。它和上一条是同一件事的两半。
- **轮询活性没动。** `taskResultQuery.ts` / `recoverableTimeout.ts` / 轮询循环本轮零改动，只有付费验收里观察到的 13 次轮询作为旁证。
- **错误洗白点没有清单。** 本轮修了三处真实洗白（`comfyCandidateTest.ts` 的空 `catch {}`、`residentShellDisplay.ts` 的「发送失败」、新增 `outbound-blocked` 分支），但 `generationRunController.ts` 里两处 `'生成失败'` 兜底仍在，且没有一份全链路洗白点盘点文档。

## 验收

- 真实付费取回：`tests/ux/outbound-policy-paid-retrieval.e2e.mjs`（MiniMax-H3，真机 fake-ip 开启下 `api.apimart.ai → 198.18.0.140`）。
- 门岗：`check:outbound-policy`（新增，棘轮）、`check:root-cause-contracts`、`check:boundaries`、`check:vocabularies`。
- 单测：`electron/networkOutboundPolicy.test.ts`（含「无证据 → 仍拒绝」的反向用例，一个无条件放行的实现会红）、`electron/hardenedFetch.test.ts`、`src/workbench/generationCanvas/runner/outboundBlockedRecoverable.test.ts`、`scripts/model-radar.test.ts`。
