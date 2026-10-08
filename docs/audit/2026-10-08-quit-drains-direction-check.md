# 方向检查：退出生命周期排空

## 0. 一句话根因

退出与关窗确认被多个模块分别拥有，导致可取消阶段出现多个 `preventDefault` 和无上限等待；同类修补只会继续增加状态机。

## 1. 归类表

| 提交 / bug | 直接原因 | 类根因 |
|---|---|---|
| 0.23.0 macOS 退出卡死 | task / Antigravity 各自拦截并等待未定界 Promise | 退出没有单一 owner 和总截止时间 |
| 关窗失联永久拦截 | 每个 close 请求都等待 renderer，没有超时 | 窗口确认没有接入退出生命周期预算 |

## 2. 为什么会反复出现

每个资源 owner 都能直接订阅 Electron 生命周期，局部实现看起来简单，却无法证明所有入口共享同一上限。`node scripts/door-map.mjs registerQuitDrain` 实查 7 个登记文件；原有退出搜索确认 7 个监听。

| 铁律 | 回答 | 证据 |
|---|---|---|
| ①说的=摆的 | 退出必须“最多等待 3 秒后结束”；实现把总时限放在 `quitTeardown`，与正常、抛错、挂起矩阵一致。 | `electron/quitTeardown.test.ts` |
| ②能选到 | 退出入口不再由调用方选择 owner；所有资源只能登记 required / optional 和单项截止时间。 | `electron/quitTeardown.ts`、ESLint guard |
| ③点了=以为的 | 点击退出后，正常清理退出；明确拒绝关窗仍可继续工作；无回复按确认关闭。 | `electron/windowCloseConfirmation.test.ts` |

## 3. 不改结构的可验证预测

| 预测 | 验证 |
|---|---|
| 新增任意直接 `app.on("will-quit")` 会绕过共享上限 | `electron/quitLifecycleGuard.test.ts` 的 ESLint 反例 |
| 新增一个永不 resolve 的 required drain 会再次卡死 | quitTeardown 挂起矩阵，要求 `app.exit(0)` |
| renderer 失联会让 close 永久卡住 | window close timeout 测试在 owner 预算内自动确认 |

## 4. 验收线独立性

实现线只验证单元行为与静态结构；真实 packaged macOS 退出交互需要另一条验收线，PR 正文保留“独立验收待派”。

## 5. P0 与现成方案

Electron 生命周期是通用平台能力，但“任务排空、关窗确认和用户保护共享一个总预算”是 Nomi 的生命周期约束。没有引入新依赖；直接使用 Electron 事件和现有日志出口。

## 6. 方案对比与推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 继续让各模块直接挂 Electron 事件 | 没有共享总时限 | 同类卡死继续出现 | |
| 补丁 | 给每个 listener 各加 timer | 重复状态机和多个 fallback | 竞态与超时不一致 | |
| 重写单一 owner | `quitTeardown` 登记并并行排空，静态门禁禁止旁路 | 需要迁移所有现有监听 | 资源必须声明 required / optional | **推荐** |
| 删除确认 | 关窗直接关闭 | 丢失未保存内容保护 | 用户数据风险 | |

## 7. 用户要权衡的核心

保留“有未保存内容时问一句”，同时接受渲染层失联时 3 秒后按确认关闭，以保证退出永远有界。

## 特征测试清单

- `electron/quitTeardown.test.ts`：正常 / 抛错 / 永不 resolve × 第一次 / 连点 / 取消后再退出。
- `electron/windowCloseConfirmation.test.ts`：确认 / 拒绝 / 永不回。
- `electron/quitLifecycleGuard.test.ts`：静态守卫反例与 owner 豁免。
