# 生成主干道：出站策略单一 owner + 已付费不重复扣费

> 状态：🚧 第一批已合（`fix/model-generation-core-path-20260907`，PR #563）；
> **第二轮**在 `fix/model-generation-core-path-2-20260907`，把第一轮「未做」里的四条做掉，见文末〈第二轮〉。
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

---

# 第二轮：把「未做」里的四条做掉

> 分支 `fix/model-generation-core-path-2-20260907`。上一轮诚实地列了六条尾巴，这一轮做掉前四条，
> 后两条（轮询活性 / 退役模型自动探测）只写「后续」不实现——理由见文末。

## 这一轮到底在修什么（大白话）

第一轮修的是「取回侧被自己拦住」。修完之后剩下的问题长这样：

1. **提交那一步（花钱的那一步）根本没人问过策略。** 取回侧现在会说「这个地址我不去」，提交侧照旧
   闷头把带着 API Key 的请求发出去。所以第一轮消灭的不对称，**换个方向仍然成立**。
2. **代理语义写在调用点上，而且名字层还有第二个 owner。** 取回侧原本自己写了
   `if (代理生效) { 不判地址了 }`，同时名字层（「这是不是内网」）也长在调用点自己身上。
   跳过地址层本身没错（理由见下），错的是这两件事都由调用点说了算——下一条出站路径照抄这个 `if`，
   owner 就又分裂成两份。附带一个真漏洞：调用点那份 origin 例外对 `169.254` 一视同仁，
   声明进来就买通了元数据地址。
3. **零额度夹具进不了 CI。** 真正证明「被拦 → 钱没丢 → 免费按钮按得下去」的那份验收要付费才能跑，
   于是它一年跑一次，等于没有。
4. **错误一路被洗成两个字。** 一条写清了「钱没丢、去网络设置确认代理」的错误，经过三四个
   `error.message ? error.message : '生成失败'`，到用户眼前只剩「生成失败：生成失败」。

四条其实是同一句话的四个面：**同一件事的判据/说法散在多处，就一定会在某一处说反。**

## 先查别人（第二轮）

只列这一轮新查的（第一轮那四条见上文同名小节），每条都实查过、带出处：

- **代理生效时该不该跳过目的地检查？** GitLab 撞过一模一样的题——自建实例配了代理、本机不解析域名，
  GitHub Import 全挂（<https://gitlab.com/gitlab-org/gitlab/-/work_items/378267>）。他们的处置是
  `Gitlab.http_proxy_env?` 为真就**整段跳过** DNS 重绑保护。**结论：这条查出来的是「别人也栽在这里，
  而且默认反应就是开逃生口」，不是可抄的做法。** 我们反着做：条件收进 owner，判据的对象随路由换。
- **有没有「不跳过」的同类做法？** 有，而且是把分类**下沉到代理层**：Stripe 的 smokescreen 是一台
  CONNECT 代理，自己解析每个域名并拒绝内网地址（<https://github.com/stripe/smokescreen/blob/master/README.md>）。
  **结论：桌面端没有那一层可下沉**——代理是用户自己的 Clash/Surge，我们管不着它，所以名字层必须自判。
- **「代理路由下判名字」是不是我们的发明？** 不是，是 SOCKS5 的既定语义：curl `--socks5` 本机解析，
  `--socks5h` / `--socks5-hostname` 交给代理解析（<https://curl.se/docs/manpage.html#--socks5-hostname>）。
  **结论：代理路由下本机那份解析结果根本不参与连接**，拿它当判据是在判一个不存在的目的地——
  所以正确形状是「判据的对象随路由换」，不是「换成不判」。
- **仓库里已有？** 私网判据的 owner 已经在 `electron/networkOutboundPolicy.ts:271`（第一轮建的
  `classifyOutboundAddresses`）；本轮**不新写分类器**，只在它上面加一个统一入口
  `authorizeOutboundDestination`，两侧共用。**结论：扩已有边界。**
- **依赖里已有？** 兜底文案这一族没有库可用，但「别把 unknown 洗成一句话」在仓库里已有先例：
  `src/workbench/observability/classifyError.ts:88` 的 `extractReadableErrorLine` 早就写着
  「不要又甩一句『生成失败』」。**结论：把那条已经想清楚的纪律提升成模块 + 门岗，而不是再写一遍。**

## 范围（做了什么）

### ① 提交侧也问同一个 owner

`electron/networkOutboundPolicy.ts` 新增**唯一入口** `authorizeOutboundDestination`；
`electron/vendor/vendorOutboundGuard.ts` 是提交侧那半边，`vendorHttp.requestVendor` 在发出付费请求
**之前**调它。两侧同一个函数、同一份进程内环境事实缓存。

**被拦时供应商到底有没有计费？没有——这是位置保证的，不是推测。** 判据跑在
`fetchVendorWithBaseFallback` 之前（`electron/vendor/vendorHttp.ts:171`），refusal 抛出时连接一次都
没建立，一个字节都没离开本机。这与 `vendorBaseFallback` 文件头第 3 条是同一个道理：连接未建立 ⇒
不可能已计费。**所以错误码必须分家**：`outbound-blocked`（取回侧，钱已付、免费重取）
vs `outbound-blocked-submit`（提交侧，没扣费、修好网络重新生成）。共用一个码的代价不是措辞不精准，
是给用户一句方向完全相反的假话，外加一颗根本按不动的「重新拉取结果」。

**授权是一段新的 await 窗口，取消要在里面接住。** 授权要做 DNS，于是取消多了一个落点：
调用方在这段窗口里 abort 时 signal 已经 aborted 而 fetch 还没被调用过——不接住就会被无声吞掉，
付费请求照旧发出去。`vendorHttp.ts` 在授权之后立刻查一次 `callerCancellation` 并原样抛出，
`vendorHttp.test.ts` 有专门一条钉住「窗口内取消 → fetch 零调用」。这条是本轮**自己引入又自己
修掉**的回归，写在这里不藏（发现方式：全量 gates 里 8 条 vendorHttp 用例翻红）。

私网的 vendor 地址（本地 ComfyUI、局域网 LM Studio）走**声明式精确 origin 例外**——判据照跑，
只是这个 origin 有用户配置作为证据。`169.254`/`fe80::` 不在例外里：那一段没有供应商，
唯一用途是读云主机凭证，而提交请求正带着用户的 API Key。

### ② 代理语义收进 owner，名字层不再有第二个判据

先把上一轮的形状说准，别讲得比实际更糟：`assertSafeUrl` 在**每条路由上**都判过名字，
代理生效时跳过的只是**地址层**（解析 + 地址分类）——而跳过地址层本身是对的。真正的毛病是三条：
名字层的判据长在调用点自己身上（第二个 owner）；`if (!applicationProxyActive())` 这个条件也写在
调用点（代理语义散出去了）；以及调用点那份 origin 例外能被 `169.254` 买通。

现在 owner 每一跳都被问到，条件住在 owner 里，**判据的对象随路由换**：

| 路由 | 谁开连接 | 判什么 | 为什么 |
|---|---|---|---|
| `direct` | Nomi 自己 | 本机解析出的地址，并回传 pin 住 | 本机解析结果**就是**这次连接会用的地址；pin 住堵 DNS 重绑 |
| `proxy` | 应用级/单供应商代理 | **名字**（IP 字面量私网、localhost/.local 一律拒） | DNS 在代理那侧做（SOCKS5 `socks5h` 语义），本机那份答案不参与连接 |

「判名字」不是「不判」：`http://10.0.0.5/...` 和 `http://169.254.169.254/...` 在代理路由下照拦。
测试把这条钉死了——把逃生口形状（`if (route === "proxy") return allowed`）变异进 owner，
`electron/vendor/vendorOutboundGuard.test.ts` 立刻翻红；而 `169.254` 不再能被声明式例外买通，
是本轮**唯一的行为收紧**（写在错误文案里，不藏）。

### ③ 零额度夹具进 gates

新增 / 扩写的都是 vitest，`pnpm run test` 自动带上，无需额外脚本：

- `electron/vendor/vendorOutboundGuard.test.ts`（10 例）：DNS、环境探针、代理判定全部注入，
  一次真请求都不发。**每条都配阳性对照**——「fake-ip + 无证据 → 拦」旁边就是「fake-ip + 有证据 → 放行」，
  「回环 8188 声明过 → 放行」旁边就是「同地址换端口 → 拦」。没有对照的绿灯说不清是判对了还是一律放行。
- `src/workbench/generationCanvas/runner/outboundBlockedRecoverable.test.ts`：夹具改由**真分类器**
  驱动（喂地址与环境事实给 `authorizeOutboundDestination`，拿它吐出的拒绝跑整条链），
  不再手写一条「长得像的」错误；并把最后一段走完——`recoverNodeResult` 真的走 query 拿回成片，
  且**全程没铸过付费令牌**（`mintSpendGrant` 零调用，这是「免费」二字的机器判据）。
- `src/workbench/observability/opaqueFailure.test.ts`：机器码原样穿透 + 兜底句**刻意不等于**徽标那句。

### ④ 错误洗白单一 owner + 门岗规则 4

`src/workbench/observability/opaqueFailure.ts` 的 `describeOpaqueFailure` 是唯一允许的写法；
`scripts/check-outbound-policy.mjs` 规则 4 硬零（无基线）盯住这一族。

**全链路盘点**（供应商响应 → UI 文案，本轮实扫）：

| # | 位置 | 洗白形态 | 处置 |
|---|---|---|---|
| 1 | `electron/ai/aiSdkVendorError.ts:95` | 无状态码时整条错误退化成 `"请求失败"` | 改报**错误类名**（`AI_APICallError` 本身就是线索）。本文件必须保持 electron-free，用不了 `desktopT`，所以这一侧的「有信息的替代品」是类名而不是一句 i18n 文案 |
| 2 | `src/workbench/api/taskApi.ts:223` | `evt.message \|\| '文本流式生成失败'` | → `describeOpaqueFailure` |
| 3 | `src/workbench/generationCanvas/runner/generationRunController.ts:345` | 重试循环跑完仍无结果 → `'生成失败'` | → `describeOpaqueFailure` |
| 4 | 同上 `:399` | `error.message ? … : '生成失败'`（存进 `node.error`，错误卡的唯一输入） | → `describeOpaqueFailure` |
| 5 | `src/workbench/generationCanvas/runner/recoverTaskActions.ts:106` | 找回查询报错 → `'拉取结果失败'` | → `describeOpaqueFailure`。**这条最要命**：出站被拦最常落在这条路径上，而那条错误的全部价值就在它的机器码上 |
| 6-8 | `src/workbench/generationCanvas/store/canvasRunActions.ts:43/115/134` | `\|\| 'Generation failed'` 三处 | → `describeOpaqueFailure` |
| — | `electron/tasks/comfyCandidateTest.ts` 空 `catch {}`、`residentShellDisplay.ts` 的「发送失败」 | 第一轮已修 | — |
| — | `String(error)` 一族（`vendorHttp.ts:162`、`catalogTaskResolve.ts:178` 等 5 处） | **不是**洗白：原值被保留，信息不丢 | 不动 |

**机器码活得下来吗？实查过**：`matchNomiErrorCode` 用 `/NOMI_ERR::([a-z-]+)::/` 从**任意位置**抠码
（`electron/shared/nomiErrorCodes.ts:30`），所以它能穿过 `VendorRequestError` 的包装、
`encodeVendorErrorMessage` 的 base64 前缀和 Electron 的 `Error invoking remote method` 外壳。
`outboundBlockedRecoverable.test.ts` 里那条端到端断言就是它的看门狗。

**加规则先验会红（R17）**，两次都留了记录：
- 把 `generationRunController.ts:399` 变异回 `? error.message : '生成失败'` → 门岗报
  `错误洗白（硬零）：…:399`，exit 1；
- 词表加进 `请求失败` 后，门岗立刻抓出 `electron/ai/aiSdkVendorError.ts:92`（本轮真实存量），
  修完归零。

规则只认**兜底语法位**（`||` / `??` / 三元的 `:`），所以 i18n 词表里的 `reason: '生成失败'`
（徽标当然该有这句）不误伤；注释行豁免——讲清这一族长什么样，本身就得把那个写法原样引出来。

## 不动项

- **提交侧不接管「怎么出去」，只回答「能不能出去」。** 不在 `vendorHttp` 里插 pin 住的 dispatcher：
  提交侧已经有自己的传输链（`vendorBaseFallback` 的官方备用域 + 单供应商代理），再插一个会把那条链
  整个接管掉——那是另一个并行版（P1）。DNS 重绑残余风险登记在合同 `residual_risks`。
- **不碰轮询循环**（`taskResultQuery.ts` / `recoverableTimeout.ts`）。见〈后续〉。
- **不碰模型目录与雷达**（第一轮已处置 `deepseek-v3.2-think`）。
- **不动 `dismissRecoverableNode` 的硬编码文案**：那是既有 i18n 欠账（`check:i18n` 基线内），
  与本轮的洗白族不是同一件事，混进来只会把 diff 摊大。

## 回滚

三个 commit 各自独立可 revert：

1. `fix(outbound): 提交侧与取回侧问同一个出站 owner…` — revert 后取回侧回到第一轮形状（代理跳过分类），
   提交侧回到零策略。**不影响持久化**：`node.error` 只是字符串，没有 schema 变化。
2. `fix(observability): 错误洗白收成单一 owner…` — revert 后错误卡回到「生成失败：生成失败」，
   门岗规则 4 一并消失（它与被修点在同一个 commit，不会出现「规则在、修没了」的半截态）。
3. 测试与文档 commit — 单独 revert 只掉证据不掉行为。

没有数据迁移，没有 feature flag，没有需要清理的落盘状态。

## 验收门

- 门岗：`check:outbound-policy`（规则 4 新增，两次红证明见上）、`check:root-cause-contracts`、
  `check:boundaries`、`check:i18n`、`check:test-types`、`check:prior-art`。
- 单测（全部零额度、可在 CI 常驻）：`electron/vendor/vendorOutboundGuard.test.ts`、
  `electron/hardenedFetch.test.ts`、`electron/networkOutboundPolicy.test.ts`、
  `src/workbench/observability/opaqueFailure.test.ts`、
  `src/workbench/generationCanvas/runner/outboundBlockedRecoverable.test.ts`、
  `src/workbench/generationCanvas/runner/classifyGenerationError.test.ts`。
- 变异验证（证明断言不是死的）：① 代理路由早退回 `allowed` → guard 测试红；
  ② 两个出站码不再分家 → 提交侧两条红；③ 洗白写法回归 → 门岗红。三条都实跑过。

## 后续（这一轮明确不做，附判据）

- **轮询活性。** `taskResultQuery.ts` 的轮询没有「上游还活着吗」的判据，只有墙钟超时。
  要做对得先回答「多久没有状态变化算死」——那是个需要真实分布的问题，而我们手上只有付费验收里
  观察到的 13 次轮询这一个样本。**先攒证据再设阈值**，凭感觉写一个数就是下一次误判的种子。
- **退役模型自动探测。** 雷达只 diff **列表**，而 `deepseek-v3.2-think` 恰恰是「列表里还在、实调已死」。
  真判据是带鉴权的最小 `/v1/chat/completions`——那要花钱，且每个供应商的最小可调用形状不同。
  做法应当是：先给每个 vendor 档案声明一条「最便宜的活性探针」，再由雷达按周批量跑，
  而不是在雷达里写死几个模型的探针。**前置条件是档案里那条声明，本轮不动档案 schema。**
