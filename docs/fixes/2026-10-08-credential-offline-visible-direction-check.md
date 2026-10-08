# 方向检查：离线凭据可见性

## 0. 一句话根因

`ApiKeyRecord.enabled` 同时被当成“材料是否存在”和“当前是否已启用/验证通过”，所以离线待验证记录在投影时被说成没有密钥。

## 1. 归类表

| 提交 / bug | 直接原因 | 类根因 |
|---|---|---|
| 095fc14a 引入的离线待验证凭据 | `credentialRecordCounts` 排除了 `enabled=false`，`readCatalog` 又用解密状态投影 `hasApiKey` | 材料存在、验证状态、启用状态没有独立事实 owner |

## 2. 为什么会反复出现

这不是某个供应商的特殊行为：所有探测型供应商都会在网络不确定时保存 `enabled=false, verificationPending=true`。同一布尔字段被持久化层、可用性派生器、设置页和模型列表共同解释，任何一个调用者都会复现。

| 铁律 | 回答 | 最小证据 |
|---|---|---|
| 说的=摆的 | “存了但未验证”必须同时落为材料存在、待验证、不可用；不能把它压成 missing。 | `credential-offline.walk.mjs`；`ApiKeyRecord` |
| 能选到 | 所有 `hasApiKey` 读入口都继续从主进程投影读；可用性继续从 `availability` 读。 | `node scripts/door-map.mjs hasApiKey` |
| 点了=以为的 | 设置页看到“已保存·未验证”，联网复验后再变化；401 错误说失败原因并保留旧 key。 | `KnownVendorKeyConnectPage.tsx`；`credentialFailure` |

## 3. 不改结构会冒出的可验证预测

| 预测 | 验证 |
|---|---|
| 任何 `enabled=false` 但有可解密材料的记录仍会被投影成 `hasApiKey=false`。 | 状态矩阵测试的红灯；离线 Electron 走查的读回断言 |
| 只修 APIMart 会让其他探测型供应商继续错误。 | 矩阵覆盖通用 `ApiKeyRecord`，不使用供应商名分支 |
| 只改渲染层会让模型列表和生成仍读到 missing。 | `createCatalogAvailability` 与主进程 listing 测试 |

## 4. 靠子独立性检查

- 实现线不承担另一条线 F-vendorhealth2 的验证请求构造；本线只改状态 owner 和投影。
- 状态矩阵由主进程单测覆盖，Electron 走查只验真实 UI 与持久化读回。

## 5. P0：领域独有性

这是 Nomi 的凭据生命周期语义（材料、验证、启用、可用性），不是通用库能力；继续使用 Electron safeStorage 和现有目录/可用性框架，不自写加密或请求协议。

## 6. 方案取舍

| 选项 | 代价 | 风险 | 推荐 |
|---|---|---|---|
| 改渲染层在 pending 时猜“有 key” | 只遮住一个页面，模型列表和主进程仍错误 | 继续分裂判据 |  |
| 为每个供应商加分支 | 复制验证语义，新增供应商必漏 | 类问题持续出现 |  |
| 在材料投影 owner 分离材料与启用 | 改动集中，所有读者自动得到一致事实 | 需要补矩阵与旧数据测试 | ✓ |

## 7. 用户要权衡的核心

用户需要知道“密钥确实存下来了”与“现在还不能用”是两件事；修复选择诚实表达两者，而不是用一个“没有密钥”让用户重复粘贴。

## 特征测试清单

- `electron/catalog/credentialStateMatrix.test.ts`：锁住材料存在、解密状态、启用/停用和 UI 文案的交叉矩阵。
- `electron/catalog/catalogReadCache.test.ts`：锁住离线 pending 持久化后 `hasApiKey=true`。
- `tests/ux/credential-offline.walk.mjs`：真实 Electron 读回、重开页面和联网复验。
