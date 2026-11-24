# APIMart 接入检查应分别读账户余额和 Key 额度

**全图（交接处表外）**　候选 Key 保存、已存 Key 回查 → 主进程读取两个官方端点 → IPC 快照 → 接入页两行数字和充值提示。发送键旁的余额读取只需账户端点。入口可用 `node scripts/door-map.mjs checkVendorAccountBalance` 和 `node scripts/door-map.mjs readVendorAccountBalance` 复核。产品判据见 `docs/design/proposals/2026-11-03-apimart-experience/contracts.md:24` 和 `docs/design/boards/2026-11-07-model-surfaces/source/canvas.json:186`。

### 0. 一句话根因

主进程把单个 Key 的额度交给了需要账户余额的读者，数据经过 IPC 后，界面已经无法还原两笔钱各自的来源。

### 1. 归类

| 提交 | 直接原因 | 归类 |
|---|---|---|
| `22ec8bed9` → `991aa3441` | 账户读面只取 `/v1/balance`。接入页后来要求明确的账户快照才展示充值，生产者仍只填通用 `balance` | 同一来源缺失。真零余额到不了充值提示，发送侧还会把 Key 额度当账户余额 |
| `c83694a96` | `canvasHandOver.ts` 曾允许绕过主进程设置决定第三方托管 | 授权归属，仅共享目录 |
| `ba69f4086` | `projectSaveFailure.ts` 涉及隔离写入失败的交付与提示 | 保存完整性，仅共享目录 |

`fix-churn.mjs` 对本次代码文件只报 `electron/shared/contracts/` 14 天内已有两个 fix。直接文件 `vendorAccountBalance.ts` 在该目录同期的三次历史改动均为 feat，无 fix 命中。

### 2. 为什么会再出现

两个端点使用同名数值字段。旧 IPC 允许省略账户快照，旧测试又断言账户查询必须请求 Key 路径。最早可拦在设计合同转成读取测试时。体验铁律 ⑫ 的判据是粘贴或回查后，账户和 Key 各显示自己返回的数，只有账户明确返回零才提示充值；⑩ 的草稿参数和⑪ 的模型选项不经过这条链。

### 3. 可验证预测

| 保留旧结构时的预测 | 验法 |
|---|---|
| 账户为零、Key 不限额时，充值提示缺失 | 按 URL 分别回 `{remain_credits:0}` 和 `{unlimited_quota:true}`，读取快照再检查接入页 |
| 账户 52.3 积分、Key 为零时，发送侧会读到零；账户读取失败时也可能读到 Key 的零 | 固定 Key 响应，先后令账户回 52.3、HTTP 503，断言发送侧依次读到 52.3、未知 |
| 沿用共用解析规则时，账户 `-1` 会显示不限额，缺少单位时会凭空多出美元金额 | 将账户单独返回 `{remain_balance:-1}`、`{remain_credits:7}`。前者应保留未知，后者只能证明有 7 积分 |

### 4. 判据独立性

独立对照依据是 11 月 3 日合同 F02、11 月 7 日模型板和 APIMart 的端点定义。旧代码 `0dbb2b840` 上的新读取测试 14 红、8 绿，第一处实际请求是 `/v1/balance`。同一版旧测试第 91 行恰好要求这个地址，修正来源会使旧断言变红。真实账户返回何种单位仍须以该账户可核实的数据为准。[账户端点](https://docs.apimart.ai/en/api-reference/account/user-balance) · [Key 端点](https://docs.apimart.ai/en/api-reference/account/token-balance)

### 5. 整块归属（P0）

这一整块：把当前连接的账户资金与 Key 额度交给接入检查和发送侧，职责见 `docs/design/proposals/2026-11-03-apimart-experience/contracts.md:28`。
归谁：APIMart v1 定义每个端点的对象，Nomi 主进程连接读取边界负责按该定义返回快照，原入口见 `0dbb2b840` 的 `electron/ai/onboarding/vendorAccountBalance.ts:75`。
我们哪里绕开了它：同版 `electron/catalog/apimartVendor.ts:71` 将账户查询配置成 Key 路径，`electron/ai/onboarding/vendorAccountBalance.ts:72` 把那份结果直接交给账户读者。

### 6. 三条路

| 选项 | 做法与代价 | 复发与风险 |
|---|---|---|
| 沿原方向修 | 保留单请求，界面凭字段猜账户和 Key | 两个端点同字段；账户为零或未知时仍会漏报或误报 |
| **换成官方双端点（推荐）** | 保存与回查时主进程并行各读一次，替换旧通用字段。发送侧只读账户。旧连接按已存凭据读取，无存量数据迁移 | 每次接入检查多一次只读请求。按来源隔离缺数、单位和 Key 的不限额标记，单端失败仍可保留另一端的事实 |
| 删掉应用内账户余额和充值判断 | 保留 Key 验证；新旧用户都去官网核对余额 | 消除应用内串值，但账户确实为零时，用户必须离开接入流程才能发现原因 |

### 7. 用户要权衡的核心

一次接入检查多发一个并行 GET，创作者就能知道应当充值、调整 Key 额度，还是稍后重查。目录热点符合协调代批例外，前提是同提交替换旧读法，不在界面新增推测分支。

**特征测试**　`electron/ai/onboarding/vendorAccountBalance.test.ts` 守端点与来源组合，`src/ui/onboarding/ApimartConnectPage.test.tsx` 守充值提示与回查。上述 14 红为按路径返回的确定性复现，未使用真实账户。
