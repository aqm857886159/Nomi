# 设计卡：删掉出网「按目的地地址拒绝」这一层

四类：碰带钱的发送路径（提交 / 轮询 / 上传）→ 9 格全填。方向复盘：`docs/engineering/direction-checks/2026-11-13-outbound-address-layer-delete.md`。
协调裁定（2026-11-13）：丙 1-3（媒体）按乙删；丙 4 / 丙 5（取回的文字进模型）本轮原样保留。

## 门表（`node scripts/door-map.mjs hardenedFetch hardenedFetchText authorizeSubmitDestination authorizeOutboundDestination trustedRetrievalOrigin`：main 上 23 扇 → 本分支 20 扇；`authorizeOutboundDestination` 2 → 1，`trustedRetrievalOrigin` 2 → 0）

| 类 | 入口（谁调） | 带密钥 | 取回的内容去哪 | 处理 |
|---|---|---|---|---|
| 甲 | `vendor/vendorHttp.ts` → `authorizeSubmitDestination`（提交 / 轮询 / multipart 上传 / customCall） | 带 | 供应商 | 删地址判断，留「密钥只发往绑定 origin」 |
| 甲 | `connectors/tikhubConnector.ts` | 带 | 回 Agent（固定 TikHub 域名白名单在前） | 删 |
| 甲 | `localRuntime/localAiExternalProbe.ts` | 可带 | 只读状态码 | 删（含 `allowedPrivateOrigins`） |
| 乙 | `assets/providerMediaFetch.ts` `fetchProviderMedia` / `probeProviderLink`（`generationOutputMaterializer`、`localizeTaskAsset` → `projectAssetStore.importRemoteAsset`、`downloadAsset` / 自动保存） | 不带 | 项目素材 | 删（含 `trustedPrivateOrigin` / `trustedRetrievalOrigin`） |
| 乙 | `tasks/taskResultCertification.ts` → `providerAdapter/certificationMedia.ts` | 不带 | 认证证据（本机） | 删 |
| 乙 | `downloads/verifiedAssetCache.ts` | 不带 | 本机缓存（哈希校验） | 删 |
| 乙 | `connectors/tikhubRoute.ts` 健康探测 | 不带 | 只看状态 | 删 |
| 乙 | `localSpeech/localSpeechServer.ts`（自家回环 sidecar） | 不带 | 本机 | 删 `allowedPrivateOrigins` |
| 乙 | `integrationSession.ts` ComfyUI JSON / view | 不带 | 本机认证 | 删 `allowedPrivateOrigins` |
| 乙 | `video/extractVideoFrame.ts` | 不带 | 本机帧 | 删 |
| 乙 | `promptLibrary/promptLibraryStore.ts`（代码写死的来源） | 不带 | 本机 | 删 |
| 丙1 | `ai/modelImageInput.ts` `readModelImage`（textTaskRunner / antigravityTask） | 不带 | 内联发给模型 | 按协调裁定删；类型白名单 png/jpeg/webp/gif（响应头） |
| 丙2 | `audioTaskRunner.ts` `readAudioBytes` | 不带 | multipart 上传给转写供应商 | 删；响应头白名单 audio/ video/ octet-stream，无文件头校验 |
| 丙3 | `catalog/dreaminaInputFiles.ts` | 不带 | 即梦 CLI 上传 | 删；响应头白名单 image/ video/ audio/ octet-stream，无文件头校验 |
| 丙4 | `catalog/catalogCommit.ts` `fetchModelCatalogDocs` | 不带 | 正文回给 Agent / 模型 | **不动**：显式传 `textEntersModelContext: true` 走原判据 |
| 丙5 | `providerAdapter/providedDocs.ts`、`docsDiscovery.ts` | 不带 | 接入编译器喂给模型 | **不动**：同上 |
| — | `catalog/multipartOperation.ts` `resolveReferenceMediaBytes`（appFetch 取参考图再上传） | 不带 | 供应商 | 今天就没有地址判断，不动，只记 |

## ★0 先查别人

- GitLab · 自建实例配了代理后 DNS 重绑保护误杀导入（https://gitlab.com/gitlab-org/gitlab/-/work_items/378267）· 有代理时整段跳过检查 · **确认了**「删」：连服务端产品在代理下都放弃按本机解析判。
- Stripe smokescreen（https://github.com/stripe/smokescreen）· 把 SSRF 判据放进服务端出口代理 · **确认了**：这是多租户服务端的问题，桌面单用户软件没有那一层，也没有那种威胁模型。
- curl `--socks5-hostname`（https://curl.se/docs/manpage.html#--socks5-hostname）· 代理侧解析时本机答案不参与连接 · **确认了**根因：本机 DNS 答案在代理下不是判据。
- Cherry Studio / 本仓 `catalog/credentialBinding.ts:1` · 密钥绑定保存时确认的地址 · **确认了**「留下密钥两条」：真正要护的是密钥，不是目的地地址。
- 出口：`electron/networkOutboundMessage.ts:40`（旧）· 被拦后的出口是「去设置确认代理 / 重新取回」，本轮整条拒绝删掉，开代理的人不再需要出口 · **改变了**：甲乙丙1-3 的拒绝与恢复按钮删除；丙 4 / 丙 5 原出口不变。留下两条的出口：密钥换 origin → 「模型接入」里重新保存密钥；带密钥跳转 → 把接入地址改成跳转后的最终地址（改地址就是重新确认，见 ★4）。

## ★1 用户怎么用

当我开着代理（Clash / Surge TUN、fake-ip）、或把接入地址设成本机 `127.0.0.1` 中转 / 局域网 NAS / 公司内网网关时，我想点「生成」就发出去、成片能取回到画布，以便不用再碰「发送前被本机拦下」。
步骤：1 模型接入填地址并保存密钥 → 2 画布写提示词 → 3 点生成 → 4 提交 → 5 轮询 → 6 取回成片落到画布 → 7 下载 / 自动保存。
不做：不新增设置、开关、警告弹窗；不改代理设置；不动密钥两条判据；丙 4 / 丙 5 不动。
已知坑：取回侧供应商返回内网链接现在也照取（不带密钥）。
真实任务：① 开 Clash TUN 用 APIMart 生成一条视频并取回（用户 2026-11-12 那一次）；② 本机回环中转作为接入地址生成一张图；③ 局域网名字 `nas.lan` 中转出图。
指标：主指标「开代理用户提交被本机拒的比例」目标 0（量具：`electron/outboundNoAddressBlock.test.ts` 矩阵；线上无遥测——拒绝遥测随这层删除，未验证：缺线上量具）；护栏「带密钥请求发往未绑定 origin 次数」0（量具：`credentialOriginBinding.test.ts`）；护栏「带密钥请求跟随跳转次数」0（量具：`credentialRedirect.test.ts`、`hardenedFetch.test.ts`）。

### ★1b 连带界面
错误卡：「发送前被本机拦下 / 取片被安全策略拦下」两种不再出现；节点「重新取回」按钮的判据（取回族）保留，只去掉 `outbound-blocked` 这一个码。设置页「检测到本地代理」那一行本轮不动（见报告）。

### ★1c 老用户
- 停在「发送前被本机拦下」（error + `NOMI_ERR::outbound-blocked-submit::`）的镜头：升级后 `matchNomiErrorCode` 按已删码表（`nomiErrorCodes.ts` `RETIRED_CODES`）读成无码，是一张普通失败卡（不冒充凭据绑定那一类），「重试」可点，这次发得出去。
- 停在「取片被拦、可找回」（recoverable 或 error + `NOMI_ERR::outbound-blocked::` + taskId）：已删码表把它读成 `retrieval-download`，仍属取回族——有 taskId 就落可找回，「重新取回」可点、这次取得回来（钱已付，不让人重新生成）。
- 设置 / 模型 / 项目：无存量改动。退回上一版：数据不变，照旧可开。
- 证据：仓库没有这种形状的旧数据（`tests/fixtures/old-user-data` 无 outbound-blocked），按旧版代码（origin/main `describeOutboundRefusal`）造节点形状写进测试 `src/workbench/generationCanvas/runner/retrievalRecoverable.test.ts` 的「老用户」一组。

## ★2 谁说了算
- 「密钥能去哪」：`catalog/credentialBinding.ts` `judgeCredentialDestination`，唯一调用点 `vendorOutboundGuard.authorizeSubmitDestination`。
- 「带密钥不跟跳转」：`credentialRedirectPolicy.ts`（appFetch）+ `hardenedFetch` 的 `carriesSensitiveHeaders` 一句。
- 「取回的文字进模型时按地址判」：`networkOutboundPolicy.authorizeOutboundDestination`，只剩 hardenedFetch 一个调用点，且只在 `textEntersModelContext` 为真时走（调用方：catalogCommit、providedDocs、docsDiscovery）。
- 门：`door-map authorizeOutboundDestination` 从 2 扇降到 1 扇。

## ★3 一致与复用
以前定过：2026-09-07「一个 owner、两侧同判」（`docs/fixes/2026-09-07-outbound-policy-split-across-submit-and-retrieval.root-cause.json`）——本轮删掉其中「地址拒绝」的那半，owner 只服务丙 4 / 丙 5；#975「取回信任接入 origin」随之无对象，删。三条路选删（方向复盘 §6）。复用：密钥两条全是现有代码，不新写。

## ★4 全状态
成功：生成 / 取回照常。失败：只剩供应商 / 网络真实错误（DNS 失败走 `describeNetworkError`）。密钥换 origin：错误卡「这次生成没发出去：密钥要去的地址不是你保存它时确认过的那个」，下一步「模型接入 → 重新保存密钥」。带密钥遇跳转：「服务商地址发生了跳转，为保护你的密钥已停止请求」，下一步「把地址改成跳转后的最终地址再试」。核实过：在设置里保存新地址时 `rendererCatalogMutation.upsertRendererCatalogVendor` 会调 `followSavedAddressWithCredential` 把密钥绑到新 origin（保存那一下就是新的确认），所以两句密钥文案的下一步今天就走得通，**一字不改**。取消中 / 过期 / 能力不可用：不变。文案中英同改，`check:i18n`。

## 5 中途表
本改动只删判据，不新增状态。提交前停 / 关窗 / 断网 / 重启 / 连点：与 main 相同（判据在 fetch 前同步完成，删后少一次 DNS + 探测）。花费：被删的拒绝本来不扣费；删后请求真的发出，扣费与正常生成一致。

## 6 外部数据与失败
供应商返回的结果链接（任意 host，含内网）：照取，不带密钥；类型 / 大小 / 时限白名单不变。DNS 失败：传输层报「DNS 解析失败」，不再先被策略包装。

## ★7 性能
不适用：不新增交互；删掉一次 DNS 解析与 1.5s 上限的代理探测，只会更快。

## 8 真实条件
macOS 本机回环假上游 + 真 Electron（隔离资料目录）：见 PR「真实场景复现」。Windows：unverified（2 条：Clash Verge TUN 提交与取回）。真代理：unverified（任务书不碰代理）。

## 拍板图清单
不适用：不新增界面，只删错误文案与其恢复路径（§1.0：删掉的东西不留空壳、不留指向它的入口）。

## ★9 验收与反例（动手前写全）

| # | 检查 / 反例 | 改坏怎么改 | 期望 |
|---|---|---|---|
| 1 | 密钥只发往绑定 origin | `authorizeSubmitDestination` 里 `if (!verdict.allowed)` → `if (false)` | credentialOriginBinding / outboundNoAddressBlock 红 |
| 2 | 带密钥遇跳转即停（hardenedFetch） | `allowRedirect` 去掉 `!carriesSensitiveHeaders` | hardenedFetch.test 红 |
| 3 | 带密钥遇跳转即停（appFetch） | `withCredentialRedirectPolicy` 直接 `return init` | credentialRedirect.test 红 |
| 4 | 开代理：接入域名解析到 198.18 提交、取回都过 | 把 `authorizeOutboundDestination` 接回默认路径 | outboundNoAddressBlock 红 |
| 5 | `127.0.0.1` 接入地址提交、取回都过 | 同上 | 红 |
| 6 | 局域网名字 `nas.lan` 接入地址提交、取回都过 | 同上 | 红 |
| 7 | 供应商返回的结果链接指向 `192.168.x` 照取（不带密钥） | 同上 | 红 |
| 8 | 丙 4 / 丙 5 仍按原判据拒 `127.0.0.1` 文档 | 去掉 `textEntersModelContext` 判断 | outboundNoAddressBlock 红 |
| 9 | 出网被拒时的尝试认领（unsentAttemptClaim 矩阵 `write-then-refused`）用换 origin 触发，不出真网 | 把那格的密钥绑定改回同 origin | 矩阵红 |
| 10 | `git grep` 删干净（协调裁定口径）：`looksLikeFakeIp` `trustedRetrievalOrigin` `trustedPrivateOrigin` `allowedPrivateOrigins` `outboundBlockedRecover` `submitPrivate` `fakeIpBlocked` `setSubmitOutboundDepsForTests` `OutboundStage` 生产与测试零；`outbound-blocked-submit` 只剩已删码表与老数据测试；分类器（`classifyOutboundAddresses`、`isBenchmarkingAddress` / `BENCHMARKING_RANGE`）、代理探测与重探只服务丙 4 / 丙 5：调用点 hardenedFetch（判地址那条路）、proxyIpc（启动种实验室 origin、设置面板探测 / 重探）、systemProxy（「检测到本地代理」那一行） | — | 零残留 |
| 11 | 丙类清单 | — | 报告列出 |
| 12 | 老用户两种形状（见 ★1c） | 删掉 `RETIRED_CODES` 的映射 / 把 `outbound-blocked-submit` 映射到取回族码 | `retrievalRecoverable.test.ts`「老数据」组、`classifyGenerationError.test.ts`「老数据」组红 |

回滚：revert 本分支的提交。真实场景复现：用户那次是开着真代理 + APIMart；本线用回环假上游 + 真 Electron，接入地址 `http://127.0.0.1:<port>`，修前（origin/main）提交被拦、修后提交与取回成片落画布。差别：没有真代理、没有 198.18 解析（由单测矩阵覆盖）。
残余风险：恶意中转站可以借 Nomi 往局域网发一次不带密钥的请求（内容只留在本机项目）；丙 1-3 媒体取回同样不判地址（只有响应头类型白名单，音频 / 即梦收 octet-stream，无文件头校验）；丙 4 / 丙 5 待定（见报告）。

## 门岗 `check:outbound-policy`：保留、缩小

它不只守这一层：规则 1（生产代码不许有关掉分类器的 env 开关）与规则 3（`isPrivateHost` 只许一个 owner）守的是丙 4 / 丙 5 还在用的分类器；规则 4（错误洗白兜底句硬零）和地址无关。删掉的是规则 2（谁能 import `appFetch` 的棘轮）：它守的是「裸出口不过地址判据」，现在默认路径本来就不判，没有对象了。基线 `scripts/outbound-policy-baseline.json` 只剩 `privateHostImporters`（4 个：`httpConnector` 拿它认本机运行时、`systemProxy` 拿它做代理绕行，两个测试）。密钥两条不归它守（`check:credential-origin` 与凭据测试）。`package.json`、`docs/engineering/commands.md` 不用改（命令名不变，commands.md 本来没有这一行）。

## 丙 4 / 丙 5 待定（只陈述事实）

1. 原判据挡什么、放什么：名字层直接拒回环 / 私网 / 链路本地字面量、`localhost`、`.local`、`169.254.x`、`fe80::`；唯一例外是实验室精确 origin，只在未打包构建里有。走代理（系统代理 / 供应商线路）时只判名字；直连时在本机解析，答案落进私网 / 回环 / 链路本地就拒，落进 198.18/15 只在探测确认本机是合成解析器**且**目标是带点的公网名字时才放。
2. 开着代理但探测没确认时公网文档会不会被误拒：会。TUN / fake-ip 把公网文档域名解析到 198.18.x，探测没确认（启动早于代理、探测超时、代理的合成段不在 198.18/15）→ 拒，错误卡说「没有读取这个网页：… 解析到内网地址 198.18.x …请检查 DNS 或代理后再试；也可以把文档内容直接粘贴进来」（有出路：粘贴正文）。
3. 本机中转（localhost relay）的文档今天读不读得到：打包版读不到（名字层直接拒 `localhost` / `127.0.0.1`，实验室例外打包版不生效）；开发版只有被种进实验室精确 origin 的那一个读得到。
