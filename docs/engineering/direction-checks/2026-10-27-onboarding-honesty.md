# 方向检查：接入自检与花费例外登记

### 0. 一句话根因

接入协议探测、设置状态词和附属付费例外分别由调用点、i18n 投影和登记备注维护，缺少一个共享的免费探测边界与到期门，所以同类“探测花钱/自检冒充试跑/例外失真”会反复出现。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 2026-10-27 onboarding-honesty | `probeOneProtocol` 对候选协议发真实 POST；`verified` 投影成已测试；例外文字没有机器到期字段 | 接入探测费用与用户可见证据边界未收口 |

### 2. 为什么这一类会一直出现

协议识别把“哪套 wire”与“地址/密钥能否通过免费检查”混成一个动作；状态投影把自检事实直接复用成生成事实；附属付费口只写在 notes 里，门岗无法判断到期。它违反铁律 ⑩：按钮显示的“测试/验证”与真实动作（仅 GET 模型列表、没有生成）不一致；也触及 ⑫：用户点“测试连接”预期是检查配置，实际却可能触发生成请求。本次把探测收口到 `credentialProbePlan → fetchModelList`，并让状态写明“还没试跑”。

### 3. 不改结构的话，接下来会冒出什么（2–3 个可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 新协议分支会再次在连接按钮中加入 POST | `rg -n 'method:\s*["']POST|probeOneProtocol' electron/ai/onboarding`；四分支环回夹具断言 POST=0 |
| 新状态键会把自检说成 verified/tested | `rg -n -i '已验证|已测试|verified|tested' src/i18n/locales/onboardingProviders.ts`；中英词表回归测试 |
| 附属付费口会在到期后继续放行 | `CONCEPT_OWNERS_TODAY=2026-12-16 node scripts/check-concept-owners.mjs` 必须非 0 |

### 4. 靶子独立性检查

本次靶子是环回 HTTP 请求方法/路径、词典值和概念 owner 门岗的确定性输出，三者不依赖真实供应商或同一 UI 断言；构建后 J04 走查未通过的是既有入口锚点漂移，未被当作实现通过证据。没有发现“修对了反而掉分”的先例。

### 5. P0：这些是我们独有的吗？现成方案有哪些

`fetchModelList`、HTTP 方法记录和到期日期校验是通用能力，已复用仓库现有实现与 `check:concept-owners`，没有新增 npm 包或新门岗。`credentialProbePlan` 是 Nomi 的凭据/花费语义，属于领域 owner；自写登记 `gate-family` 仍在复评期，本次只消费现有门岗并扩展一个已有检查器的字段判据。现成方案评估：标准 HTTP client 处理 GET/POST，但不知道“连接自检不能生成”；通用 policy engine 不知道 Nomi 的概念 owner 与例外账。随 `gate-family` 的既定复评日 2026-10-31 再评估迁移。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | HTTP 客户端继续复用 `fetchModelList`；日期门继续接入 `check:concept-owners`（现有仓库机制） | 无新依赖；需维护领域字段 | 通用工具不表达 Nomi 语义 | 已采用 |
| 补 | 在现有 owner 门岗增加 `exception_deadlines` 判据 | 小范围 schema 与测试 | 只补文字会再次漂移 | 已采用 |
| 重写 | 另造协议探测器或独立到期脚本 | 第二份费用/日期判据 | 产生并行 owner 与门岗 | 不采用 |
| 删 | 删除 `probeOneProtocol`、花费提示和 ComfyUI 死令牌 | 失去自动猜 chat/Responses 的快捷路径 | 用户需在首次真实生成时按错误指引换协议 | 已采用 |

本次只删旧路径、复用现有检查器，没有新增特例分支；命中目录/登记热点的协调例外适用，提交用本复盘 trailer 留证。

### 7. 用户要权衡的核心

连接按钮要不要替用户猜协议，和“点击检查绝不替用户生成”的控制权之间，选择后者；协议不确定性延迟到真实试跑并明确指路。

## 特征测试清单（动结构前先锁住现状）

- `electron/ai/onboarding/onboardingIpc.test.ts`：强制 chat、强制 Responses、普通自动、Anthropic 自动、纯可达性分支都只收到 GET，POST=0；已通过。
- `src/ui/onboarding/onboardingHonestyCopy.test.ts`：中英文状态词不再把自检写成 verified/tested；已通过。
- `scripts/check-concept-owners.node-test.mjs`：到期当天绿、次日红；已通过。
- `src/ui/onboarding/workflowPage/runTestGeneration.test.ts`：新手 ComfyUI 不再铸 grant；已通过。
- 真实 Electron J04：构建后在既有 `[data-model-home-action="custom-api"]` 入口超时，状态记为 `unverified`，不把它当实现绿灯。
