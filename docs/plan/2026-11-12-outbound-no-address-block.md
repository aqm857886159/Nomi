# 发送前不再按解析出的地址拦；取回侧开代理时不误拦

```
改动名：出网守卫地址层（提交侧删 / 取回侧换判据）    线/负责人：实现线（协调会话派）    类别：[花钱][安全]
```

动手前写；方向复盘 `docs/engineering/direction-checks/2026-11-12-outbound-guard.md`（含用户 2026-11-12 的决定）。根因合同：`docs/fixes/2026-11-12-outbound-guard-no-address-block.root-cause.json`。逃逸账本：`tests/ux/full-walk/escapeLedger/USER-20261112-outbound-proxy-blocked.json`。

## 删 / 留 / 改

| | 规则 | 这一刀 |
|---|---|---|
| 删 | R4 提交侧：对创作者保存的接入地址（`baseUrlHint` 的 origin，不分 http / https），按域名解析出的地址判内网就拒 | 整条删：同 origin 不再解析、不再判地址 |
| 删 | 「只认 IPv4 198.18/15 + 探测确认」那段豁免（`isBenchmarkingAddress`），探测只认 198.18 的判据 | 删；探测证据改为「随机不存在的名字拿到任何保留段地址（v4 或 v6）」 |
| 删 | 只为它存在的文字：`outbound.submitFakeIpBlocked`、`outbound.fakeIpBlocked`（两侧都是 198.18 专句）、界面 hint 里「确认那一行写着检测到本地代理，然后重新生成 / 重新取回」 | 删 / 改写，见文末修前修后表 |
| 改 | 取回侧（以及提交侧对非保存地址，如预签名上传目标）的地址层：探测确认合成解析器、且目标是可被代理解析的域名 → 只判名字，不解析、不 pin；要按地址拒之前当场重探一次，结果写回缓存 | 新判据 |
| 改 | 取回侧对「成片就在这家保存的接入地址上」的信任：从「只认私网字面量」扩到「同 origin 都算」，与提交侧同一句判据（不变量：提交放行 ⇒ 取回同 origin 能过） | `trustedRetrievalOrigin` |
| 留 | R1 密钥只发往保存时确认的地址；R2 地址里直接写内网 IP / localhost / .local 且不等于接入地址就拒；R3 链路本地永远拒；带密钥请求遇跳转即停；取回侧对供应商返回的陌生链接的地址检查（没确认代理时） | 不动 |
| 加 | 还留着的拒绝（两侧）匿名遥测 `network.outbound.refused`：阶段、原因、路由、地址族、地址类别、是否合成解析、探测结果；不含地址、域名、任何用户内容 | 新事件，告知范围 1「失败类别」 |

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | ① OWASP SSRF 防护速查表（cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html，2026-11-12 访问）· 情形 1「只连已知可信目标」用白名单、提醒别用 DNS 解析做校验；情形 2「攻击者能给任意 URL」才解析全部 A/AAAA 并只连验证过的地址 · **改了**：提交侧对保存的接入地址属情形 1 → 删地址层；取回侧对响应里的链接属情形 2 → 地址层留。② Chromium 本地网络访问（developer.chrome.com/blog/local-network-access；`services/network/public/cpp/ip_address_space_util.cc`）· 按解析地址分本地 / 公网，走代理的连接记 unknown 按公网处理，动作是弹权限而非静默拦 · **确认了**：确认合成解析时把本机答案当「代理在解析」、只判名字。③ GitLab #378267（gitlab.com/gitlab-org/gitlab/-/work_items/378267）· 配了代理就跳过 DNS 重绑检查 · **确认了**：这条检查在代理环境下普遍不成立；我们不整段关，只在有阳性证据时换判据。④ 同类桌面 AI 客户端：Cherry Studio `docs/dev/references/security/remote-fetch.md`（github.com/CherryHQ/cherry-studio，2026-11-12 实读）· 对**用户配置的供应商接入地址**只做字面量检查（`sanitizeRemoteUrl(url, configuredApiHost)`，显式匹配的回环 / 私网接入地址放行），不做 DNS 判断；对不可信链接才解析 + pin，并**无条件**豁免 198.18/15（「Blocking them breaks every fetch for proxy … users」）· **确认了**提交侧只留名字层；**改了**取回侧不学它按地址段豁免（那正是我们 v6 再坏的形状），改成阳性探测 + 只判名字。⑤ 现成库能否替掉取回侧这套地址判断：`request-filtering-agent`（github.com/azu/request-filtering-agent）在 DNS lookup 时按 ipaddr.js 判非单播并拒，能防重绑，但只支持 `http.Agent`，Node 内置 fetch / undici 不支持（README 链着未合的 issue），也不处理代理与合成解析；FastMCP `ssrf_safe_fetch`（gofastmcp.com/docs/python-sdk/fastmcp-server-auth-ssrf）信任代理模式下整段跳过 DNS 与地址表、并警告代理不等于同等保护 · **确认了**：这一刀换不了——我们的取回走 undici dispatcher + 应用 / 供应商代理，现成库接不进这条传输链，且「代理在解析时判什么」正是它们不管的那一半；能换的只有地址段表（ipaddr.js `range()` 可替 `networkHostPolicy` 的手写表），归 `network-stack` 登记的评估（reviewBy 2026-11-30）一起做，这一刀不新增网络栈文件。出口：Cherry Studio 同文 · 用户偏好 `app.fetch.allow_private_network` 默认开、可关，供应商接入地址走 `configuredApiHost` 显式放行 · **确认了**我们的出口就是「接入地址即放行」，这一刀把它从私网字面量扩到同 origin，不加任何确认框 | 链接如左；实读的 Cherry Studio 文档原文存在线外临时目录 |
| ★1 用户怎么用 | 当我开着 Clash Verge Rev（TUN + 默认 IPv6）点生成，我想请求直接发出去、成片也能取回，以便不用去关代理。步骤：开代理 → 开 Nomi（或反过来）→ 选 APIMart 视频模型 → 生成 → 等成片 → 成片落进项目。不做什么：不新增提示 / 确认框；不给任何代理软件或供应商写特例；不碰密钥绑定、跳转即停、链路本地。已知坑：探测把「随机名拿到保留段地址」当证据，路由器把不存在的名字劫持到 192.168.x 的网络也会被当成「在用代理」，此时取回侧对公网名只判名字（残余风险，见 ★9）。真实任务：① Windows + Clash Verge Rev TUN + IPv6，生成一条 APIMart 视频并取回（unverified：缺机器）；② macOS 开 Surge / Clash fake-ip（v4）生成一张图并取回；③ 局域网自建中转 `http://mypc.lan:8000` 生成一张图。主指标：本机拦下 / 没发出（`outbound-blocked-submit`）占视频生成的比例，基线 0.24 周期约 59/263，目标 → 0（只剩真写错内网地址）；量具：新事件 `network.outbound.refused` + `generation.completed.errorType`。护栏：取回侧 `outbound-blocked` 比例不升（量具同上）；质量：拒绝里 `probe=unconfirmed-after-reprobe` 的占比（重探后仍拒的有多少；被重探救回的不发事件）| 遥测事件定义 `electron/telemetry/telemetryEvents.ts`；矩阵 `electron/outboundAddressMatrix.test.ts` |
| ★1b 连带界面 | 生成失败卡（`outboundBlockedSubmit` / `outboundBlocked` 两组 hint）、节点可找回态的报告、任务中心那一行：文字按文末表改，按钮不变（两类主按钮都是「打开模型接入」，次按钮重试 / 重新取回；不是只给「重试」）。设置页「检测到本地代理」那一行不动，只是它读的探测结果会被重探刷新 | `src/workbench/observability/narrate.ts` `ACTION_BY_KIND` |
| ★1c 老用户 | 不碰任何存量数据。已保存的密钥：绑定不变，照旧只发往绑定 origin；修前 TUN 用户被拦 → 修后发出。http 自建中转（公网域名）：修前开代理时被拦 → 修后发出。直接写内网 IP 的接入地址（`http://192.168.1.20:8000`）：修前修后都放行（R2 精确同源例外不变），取回同 origin 修前修后都放行。局域网主机名接入地址（`http://mypc.lan:8000` 解析到 192.168.x）：修前提交就被拦（R4 不看接入地址）→ 修后提交放行、同 origin 取回放行。退回上一版：不读写任何新数据，照旧打开 | 不适用 upgrade-path：没有存量数据路径 |
| ★2 谁说了算 | 「目的地能不能出站」唯一 owner 仍是 `networkOutboundPolicy.authorizeOutboundDestination`；门 2 扇：`hardenedFetch.ts`（取回）、`vendorOutboundGuard.ts`（提交 + `trustedRetrievalOrigin` 问名字层）；提交侧入口 1 扇 `vendorHttp.requestVendor`；`trustedRetrievalOrigin` 消费者 2 处（画布 `localizeTaskAsset`、正式生成 `generationOutputMaterializer`，都不改）。环境事实（合成解析器）唯一 owner 仍是 `readOutboundEnvironment`，新增 `{ fresh: true }` 只在它里面实现，重探结果写回同一份缓存。拒绝遥测从 owner 一处发出（注入的报告器，主进程启动时在遥测生命周期里接上）。同一规则各 1 处 | `node scripts/door-map.mjs authorizeOutboundDestination` / `authorizeSubmitDestination` / `trustedRetrievalOrigin` / `hardenedFetch`（14 扇调用门，全部经同一 owner，不改调用点） |
| ★3 一致与复用 | 以前定过：09-06 取回侧 198.18 豁免（被本卡替换）；09-07 提交侧为对称接入地址层（本卡删，理由见方向复盘类根因 1）；10-04 #975 取回信任连接自己的私网 origin（本卡扩到同 origin，仍只认精确 origin、链路本地除外）；09-18 密钥绑定、09-30 跳转即停（不动）。三条路：沿原方向补段（否：下一个默认值再坏）/ 换做法（选：提交侧删 + 取回侧阳性证据只判名字 + 重探）/ 两侧全删（否：丢掉取回侧对陌生链接的真防线）。复用：判据仍是 `isPrivateHost` 那张表（探测证据也问它，不另起一张表），传输与 pin 不动 | `git grep -n isBenchmarkingAddress` 删后 0 处 |
| ★4 全状态 | 成功：直接发出 / 取回，界面无变化。失败（还会出现的拒绝）：提交侧只剩「地址里直接写了内网 / 链路本地」和「非保存地址解析到内网」→ 失败卡「这次生成没发出去」+ 改写后的 hint；取回侧「陌生链接解析到内网且重探后仍没确认代理」→ 可找回态 + 改写后的 hint。加载：探测最多多等一次重探（每个 TLD ≤1.5 秒，只在本来要拒的时候）。取消中：授权那段 await 里取消照旧原样抛出（不变）。能力不可用 / 过期 / 部分成功：不涉及。文案走 i18n（zh / en 同改），不写钱的断言 | 文末修前修后表；`pnpm run check:i18n` |
| 5 中途表 | 授权在发请求之前、不写盘：停 / 关窗 / 断网 / 重启 / 连点与现在相同。重探进行中关窗：探测是 DNS 查询，进程退出即止，不扣费；连点：并发的重探共用同一次（in-flight 复用），不会放大成 N 次 DNS；断网：重探失败按「没确认」处理，拒绝照旧（不比今天更松） | `networkOutboundPolicy.test.ts` 并发重探一格 |
| 6 外部数据与失败 | 外部来源：本机解析器的答案（Node `dns.lookup`，规范 nodejs.org/api/dns.html#dnspromiseslookuphostname-options）· 偏差：TUN 下它是代理的合成答案，不是真目的地 → 确认后不再拿它判；供应商响应里的链接 · 照旧按地址层判；代理软件默认段（Clash Verge Rev v4 198.18/16 + v6 2001:2::/64、mihomo TUN fdfe:dcba:9876::/126、sing-box / Xray 2001:2::/48、v2rayN fc00::/18）· 不再枚举，只要落在保留段表里就算证据。失败时用户看到的是本机拒绝，不甩锅给 key | 调查报告的代理默认段表（各项目源码行） |
| ★7 性能 | 不适用：不是新增功能。唯一多出来的开销是「本来要拒」时一次重探（≤2 次 DNS、各 ≤1.5 秒超时），成功路径反而少了一次提交侧解析 | — |
| 8 真实条件 | Windows：unverified（缺机器，交创作者三步验法，见 PR 正文）；英文界面：文案中英同改，`check:i18n` 过；真付费：不适用（不改花钱路径的请求本身，只删本机拦截；本线不花钱）；真规模 / 干净安装 / 键盘：不适用 | — |
| 拍板图清单 | 不适用：不改界面元素和布局，只删改错误卡里的说明文字（逐句列表交用户看） | — |
| ★9 验收与回滚 | 见下 | — |

## ★9 验收清单（动手前写全；实现线按它自验，验收线只核它）

真实场景复现：用户的流程 = Windows 上开着 Clash Verge Rev（TUN + 默认 IPv6）点生成，不到 5 秒被拦，重试 11 次都一样（协调转述的会话记录）。我走的 = 本机不碰代理，用注入的解析结果复现两种答案（v4 198.18、v6 2001:2::/fdfe::）× 探测三态，经真实的 `authorizeSubmitDestination` / `hardenedFetch` 判据（不 mock 判据，只注入 DNS）。差别 = 没有 Windows 真机与真代理，Node 在 TUN+IPv6 下是否拿到 AAAA 未验证。修前 = 矩阵里 v6 格无论探测与否都拦（`outbound-blocked-submit`），v4 格探测没确认就拦。修后 = 提交侧对保存的接入地址全放行；取回侧确认代理时全放行，「先没确认后确认」靠重探放行。

验收清单（编号即自验表行号）：

1. 提交侧 × 保存的接入地址：解析结果 {v4 假地址 198.18.0.140、v6 假地址 2001:2::5、v6 fdfe:dcba:9876::5、混合 v4+v6、真内网 192.168.1.20、真公网} × 探测 {确认、没确认、先没确认后确认} 全部放行，且不调用解析器。
2. 取回侧 × 供应商返回的陌生 CDN 域名：同一组解析结果 × 探测三态——确认 → 放行（不 pin）；先没确认后确认 → 放行（重探一次）；没确认 → 假地址 / 真内网拒、真公网放行并 pin。
3. 不变量：对上面每一格，提交侧放行的接入地址，其同 origin 的成片经 `trustedRetrievalOrigin` + `hardenedFetch` 必能取回。
4. http 自建中转（公网域名 + http）开代理：提交放行、同 origin 取回放行。
5. 内网 IP 接入地址 `http://192.168.1.20:8000`：提交放行；同主机换端口 → 拒（R2）。
6. 局域网主机名接入地址 `http://mypc.lan:8000` → 192.168.1.20、没有代理：提交放行、同 origin 取回放行；别的局域网主机名（不是接入地址）取回 → 拒。
7. 链路本地 169.254.169.254 / fe80:: 写进接入地址：提交、取回都拒（R3）。
8. 带密钥请求 origin ≠ 绑定 origin → `outbound-blocked-credential-origin`（R1，不动）。
9. 带密钥请求遇跳转 → 停（`credential-redirect`，不动）。
10. 探测证据：随机名拿到 v4 198.18、v6 2001:2::、v6 fc00::/fdfe:: 任一保留段 → 确认；公网答案（NXDOMAIN 劫持落地页）/ NXDOMAIN / 超时 → 不确认。
11. 重探：只在「本来要按地址拒」时触发，并发共用一次，结果写回缓存（之后 `lastOutboundEnvironment()` 读到新值）。
12. 遥测：每次拒绝发一条 `network.outbound.refused`，props 只含枚举 / 布尔，`isTelemetryProps` 拒收任何多余键或地址 / 域名字样。
13. 文案：`outbound.submitFakeIpBlocked`、`outbound.fakeIpBlocked` 两键中英都删且无引用；两组 hint 不再出现「检测到本地代理」与 Clash / Surge / sing-box 字样；`check:i18n` 过。
14. `git grep isBenchmarkingAddress` = 0；`check:outbound-policy` 绿（没有长出第二个分类器）。

反例（改坏 → 红、还原 → 绿，日志进报告）：
- A 把提交侧地址判断加回去（保存的接入地址也走地址层）→ 第 1 条矩阵红。
- B 取回侧拒之前不重探 → 第 2 条「先没确认后确认」格红。
- C 探测只认 IPv4 → 第 10 条 v6 证据格、第 2 条 v6 确认格红。
- D 删掉名字层拒绝 → 第 5、7 条红。
- E 带密钥请求跟着跳转 → 第 9 条红（`credentialRedirect.test.ts`）。
- F `trustedRetrievalOrigin` 退回只认私网字面量 → 第 3、6 条红。

这一类还会从哪回来：新代理软件 / 自定义段（不枚举段，靠阳性探测 + 只判名字，不会回来）；先开 Nomi 后开代理 / DNS 冷启动慢（重探兜住）；新的出站调用点（仍须经 `authorizeOutboundDestination`，`check:outbound-policy` 盯着）；新的「提交发到 A、成片在 A」供应商（不变量测试兜住）。残余风险：确认合成解析期间，取回侧对公网名失去「解析到内网」的拦截（代理在解析，本机答案不是真目的地；与 Chromium 对代理连接的处理一致）；路由器把不存在的名字劫持到私网地址时会被当成「在用代理」。

回滚：revert 本 PR 的实现提交（单提交，含删旧）；无开关、无数据迁移。
