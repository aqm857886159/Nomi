# 付费 POST 单一出口

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 设计卡（9 格）

改动名：付费提交单一出口　线/负责人：L-paidpost　类别：[花钱][长跑][可打断][其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者提交图像、视频、音频或 multipart 生成时，提交只离开一次可确认的传输口；预写失败在供应商声明支持幂等时自动重发一次，写出后连接断开则明确保留“结果未知”。不改变计价和回执状态机。真实任务形态覆盖同步 TTS、Whisper multipart、异步目录生成；真供应商与真付费本轮不跑。 | `electron/*paid*` 回归夹具；真实付费 `unverified` |
| ★2 谁说了算 | 概念 `production.submission-dispatch-evidence` 与“付费提交出口”归统一传输 owner；写口为 `electron/vendor/vendorHttp.ts:requestVendor`，写出证据仍由 `electron/outboundDispatchEvidence.ts` 提供；所有付费 POST 入口只能调用 `requestJson` / `requestBinary` / `requestMultipart`。 | `node scripts/door-map.mjs createFreshConnectionDispatcher outboundRequestWasNeverWritten` |
| ★3 一致与复用 | 复用 `createFreshConnectionDispatcher`、`outboundRequestWasNeverWritten`、`vendorHttp` 的 JSON / binary / multipart 包装；仅把各入口的响应解码留在入口，不保留第二套 HTTP 发送器。 | `rg -n "appFetch|hardenedFetch" electron/audioTaskRunner.ts electron/catalog/multipartOperation.ts`；`check:self-written` |
| ★4 全状态 | 空 / 加载：沿用现有任务状态；成功：沿用供应商结果；失败：沿用现有错误分类；部分成功：沿用批次逐镜回执；取消中：调用方现有取消语义；过期 / 能力不可用：沿用现有文案并给下一步；本改动不新增 UI 文案。 | `check:i18n`；现有音频 / 生成回执测试 |
| 5 中途表 | 传输前取消：不发出；预写失败：支持幂等时最多一重发，不支持时交上层现有结果未知；写出后断开 / 响应体断开：不重发、结果未知；关窗 / 重启：沿用现有提交状态机；连点：由现有提交授权和幂等键约束。 | `electron/vendor/vendorHttp.test.ts`；生产提交矩阵 |
| 6 外部数据与失败 | 供应商 JSON、二进制、NDJSON、multipart 都经过统一超时、响应上限、重定向和错误证据；供应商拒绝仍由响应状态 / 信封解释，网络失败保留 cause 链。 | `electron/vendor/vendorHttp.ts`；供应商 mapping；不连真网 |
| 7 性能预算 | 付费 POST 每次新建连接，额外成本是一次连接建立；单次响应仍受现有 `NOMI_VENDOR_HTTP_TIMEOUT_MS` 和响应字节上限约束。 | 现有 fresh-connection loopback 测试 |
| 8 真实条件 | Windows：已执行 `pnpm install`；英文界面、最小窗口、真规模、干净安装、真付费、键盘全程：`unverified`，本任务无界面且禁止真供应商。 | `pnpm install` 输出；测试命令 |
| ★9 验收与回滚 | 另一条线按门表和测试表复核：fresh socket、预写一次重发、写后不重发、音频与 multipart 入口统一出口；回滚为逐提交 `git revert`。独立验收报告由协调会话指派，当前 PR 留“待派”。 | `## 独立验收` 待派；本文件 §测试表 |

### 功能分类

- [x] 花钱
- [x] 长跑 / 可打断
- [ ] 新界面
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

## 门表

| 门 | 位置 | 改前 | 改后 | 是否花钱 |
|---|---|---|---|---|
| 目录生成提交 | `electron/capabilityCore/apimartGenerationProvider.ts:send` | 自己建 fresh dispatcher | 统一 `requestJson` → `requestVendor` | 是 |
| JSON / 二进制供应商提交 | `electron/vendor/vendorHttp.ts:requestVendor` | 共享核内新连接、无统一预写重发 | 唯一付费 HTTP 出口 | 是 |
| 音频 TTS | `electron/audioTaskRunner.ts:runDoubaoUnidirectionalTts` / synchronous audio | `hardenedFetch` / 间接 requestBinary | `requestBinary` | 是 |
| 音频转写 | `electron/audioTaskRunner.ts:runTranscribe` | 直接 `appFetch` multipart | `requestMultipart` | 是 |
| catalog multipart | `electron/runtime.ts` 注入的 `requestMultipart` | 已经走 vendorHttp | 保持并纳入出口测试 | 是 |
| 参考媒体读取 / 查询 | `electron/catalog/multipartOperation.ts:resolveReferenceMediaBytes` | GET `appFetch` | 保持 GET；不属于付费提交 | 否 |

## 测试表

| 场景 | 改前 | 改后 |
|---|---|---|
| 陈旧共享连接 | 旁路可得到 ECONNRESET / 结果未知 | 每次付费 POST 新连接，不复用空闲 socket |
| 写出前断开 | 无统一重发 | 支持幂等时同键最多重发一次；服务端仅一份 |
| 写出后断开 | 各入口错误形状不一 | 统一结果未知，不重发，服务端一份 |
| 每扇付费门 | 多个传输函数 | 入口测试 spy `vendorHttp` 统一出口 |
| 旧行为变异 | 可能仍绿 | 改回共享池的测试必须红 |

## 碰到的规则与门岗

- 触发 `fix-churn` 的热点，复盘见 [方向检查](./2026-10-08-paid-post-single-exit-direction-check.md)，提交需带 `Direction-Check` trailer。
- 根因合同必须是 schema-v3，包含 door-map、shared boundary、recurrence、prevention、class regression 和 dependency lifecycle。
- 不修改 `scripts/check-*.mjs` 判断代码、`productionPendingSpend.ts`、计价或回执状态机。

## 独立验收

待派：协调会话另派验收线；验收线编号不得与实现线相同。

## 系统改进

缺失的系统不变量是“所有花钱 POST 只有一个发送边界”。在 `vendorHttp.requestVendor` 统一新连接、写出证据和预写失败策略，并把音频旁路迁移到现有 JSON / binary / multipart 包装；结构测试与门表记录防止未来直接调用共享 `appFetch` 绕行。
