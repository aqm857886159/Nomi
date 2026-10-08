# 付费 POST 单一出口：方向复盘

## 0. 一句话根因

付费 POST 的新连接、写出证据和重发边界没有收敛到一个可复用的传输出口，音频和目录 multipart 仍能直接调用共享 `appFetch`，所以同一类陈旧 keep-alive 断开会在不同入口产生不同的回执。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| APIMart / `vendorHttp` 已有新连接 | 两条主生成路径各自装配新连接 | 付费提交传输装配分叉 |
| 音频 TTS / 转写 | `audioTaskRunner` 直接使用 `hardenedFetch` / `appFetch` | 付费提交绕过统一传输 |
| catalog multipart | 生产调用方虽注入 `requestMultipart`，但音频旁路没有复用它 | 付费提交绕过统一传输 |

## 2. 为什么会一直出现

“请求是否写出”和“如何建立连接”属于跨供应商的通用网络能力，却被各执行器按 wire 形状重复装配。音频的 NDJSON、JSON multipart 只是响应或请求编码差异，不应拥有第二个付费传输出口。缺少共享边界后，每个新端点都可能再次直接调用共享池。

这不属于体验铁律 ⑩ / ⑪ / ⑫；它是付费动作的出站事实边界。类检查由根因合同、`check:outbound-policy`、`check:transport-assembly` 和共享传输测试共同承担。

## 3. 不改结构的可验证预测

| 预测 | 怎么验证 |
|---|---|
| 新增同步付费端点会再次直接使用共享池 | `rg -n "appFetch|hardenedFetch" electron/audioTaskRunner.ts electron/catalog`，再审查所有非 GET 调用 |
| 预写断开在旁路入口不能统一重发 | 本地 loopback server + 预写连接失败夹具，比较入口的 POST 次数 |
| 写后断开会在某个旁路被误判为可重发 | loopback 收完整请求体后销毁 socket，断言 `outboundRequestWasNeverWritten` 为 false 且只有一笔 |

## 4. 靶子独立性检查

失败判据由 `outboundDispatchEvidence.ts` 定义，回归测试由传输层和各入口测试共同覆盖；没有把实现字符串当 oracle。方向复盘与任务书已经给出同一结论：复用 `vendorHttp` 的现有核，将入口迁移到它。

## 5. P0：现成方案

| 能力 | 现成方案 | 结论 |
|---|---|---|
| 每次新连接 | `electron/systemProxy.ts:createFreshConnectionDispatcher` | 复用 |
| 写出证据 | `electron/outboundDispatchEvidence.ts:outboundRequestWasNeverWritten` | 复用 |
| JSON / 二进制 / multipart 传输 | `electron/vendor/vendorHttp.ts:requestVendor` 及其三个公开包装 | 复用 |
| 连接失败后最多一次预写重发 | `vendorHttp.requestVendor` 统一实现，入口只声明供应商能力 | 补在既有出口，不新建模块 |

## 6. 接入 / 补 / 重写 / 删对比

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 把音频 JSON、NDJSON、multipart 改调用现有 `vendorHttp` 包装；保留各自编解码 | 需要调整错误适配与夹具 | 低 | **推荐** |
| 补 | 在每个旁路各加新连接和重发 | 改动分叉继续增长 | 高 | 不选 |
| 重写 | 新建第二套付费 HTTP 客户端 | 重复代理、超时、脱敏和证据 | 高 | 不选 |
| 删 | 删除音频 / multipart 能力 | 破坏现有供应商能力 | 高 | 不选 |

## 7. 用户要权衡的核心

统一出口让所有付费 POST 都诚实地遵守“预写失败最多安全重发一次、写出后结果未知不重发”，代价是入口必须放弃自己定制网络错误的直连写法。

## 特征测试清单

- `electron/capabilityCore/apimartFreshConnection.test.ts`：连续提交使用不同 socket；写后断开不重发；拒连能证明未写出。
- 新增 `vendorHttp` 传输测试：供应商支持幂等时预写失败只重发一次且服务端只收到一份；写后断开只收到一份。
- 音频和 catalog multipart 入口测试通过统一出口 spy；把任一入口改回直接 `appFetch` 时测试必须失败。

## 方向结论

本任务书已明确采用“接入现有方案 + 在 `requestVendor` 补齐策略 + 删除旁路直连”的结构性结论。后续改动必须继续引用本复盘；提交信息使用 `Direction-Check: docs/plan/2026-10-08-paid-post-single-exit-direction-check.md`。

## PR #1100 CI 回归复盘

本轮用户明确要求修复 CI 并保持判据不放宽，继续采用既定统一出口方向。热点扫描：vendorHttp 与 catalog provider 各已有 7 次 fix，audioTaskRunner 3 次；不再增加独立传输分支。

- 症状：目录执行器收到 HTTP 200 / code 1001 丢失明确拒绝；MCP C9 四镜均为 provider_not_reached。
- 直接原因：迁移只比较成功传输，漏了目录的 code 成功值约定（0/200）；共享核的通用检测仅识别部分 HTTP 风格逻辑码。音频包装与 customCall 脱敏重建错误还会丢失 providerAnswer。C9 合成 key 保存时绑定了公共 origin，发送却被既有夹具替换成 loopback。
- 类根因：迁移合同缺少“响应证据、错误包装、凭据身份仍完整”的不变量，现有测试只有旧执行器的部分拒绝样例，缺少跨出口矩阵和带真实凭据绑定的夹具。
- 换 + 删：共享核接收调用方声明的成功 code 集合，目录恢复原来的 0/200 合同；错误包装保留非敏感 providerAnswer / cause；C9 在同一 key 保存事务中把合成凭据绑定到其真正的 loopback origin，再恢复 canonical 目录。拒绝白名单、未知结果判据和出站 guard 原样保留。
- 特征证据：CI Unit 1 failed / 17425 passed；本地复现 1 failed / 12 passed。E2E 制品中四镜全为 outbound-blocked-credential-origin，供应商账本只有 GET、没有生成 POST。
- 预测：小业务码和数字字符串必须同样由目录合同判失败；任务号或 5xx 仍保持未知；音频/customCall 包装不能擦掉证据；真实绑定错 origin 在夹具模式下也必须拒绝。

通用 HTTP、脱敏和凭据绑定都复用现有模块，无新增依赖。独立验收仍由协调会话安排。
