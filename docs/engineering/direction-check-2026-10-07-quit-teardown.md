# 方向检查：退出拆除与项目打开的类根因复盘

### 0. 一句话根因

退出流程把不可逆拆除放在可取消的 `before-quit`，项目打开又把 Agent lane 当成项目 hydration 的硬依赖，两个生命周期边界都没有失败隔离。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 用户 Mac 10-07/10-08：所有项目都显示恢复失败 | `before-quit` 移除了 lane handler 后，窗口确认取消退出，残缺进程继续服务 | 可取消退出阶段执行不可逆拆除 |
| 同一事故的项目恢复失败横幅 | lane 打开失败从 `hydrateProject` 冒泡，阻止画布和时间轴进入 studio | 子系统故障升级成项目级故障 |

### 2. 为什么这一类会一直出现

生命周期拆除散在多个模块，各模块只知道「退出开始」而不知道窗口仍可拒绝关闭；项目 hydration 同时承担持久化恢复、画布提交和 Agent 连接，缺少共享的成功边界。类级预防是把拆除统一收进 `will-quit`，让 lane IPC 在进程仍活着时只返回结构化 `agent_lane_disposed`；项目打开只以持久化和画布提交为成功条件，Agent 连接作为可恢复附属能力。

| 铁律 | 类根因要回答的问题 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 不适用：本问题不是意图或草稿参数。 | Electron 事件顺序与生命周期测试 |
| ⑪ 能选到 | 不适用：本问题不是模型档案入口。 | lane IPC 类级测试覆盖 dispose 后 handler |
| ⑫ 点了=以为的 | 点击打开项目后，用户预期仍能使用画布；Agent 连接失败应只显示原因并可重连。 | `hydrateProject` 行为测试 / 真 Electron 走查 |

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 任一新的 `before-quit` 清理会在关窗确认取消后留下半拆进程 | `rg "before-quit" electron`，再运行退出生命周期矩阵 |
| 另一个可选子系统失败会再次阻止项目进入 studio | 为 hydration 的附属阶段注入失败并断言 `studio-visible` |
| lane handler 被移除会重新变成无码的 IPC 错误 | `electron/agentLane/laneIpc.test.ts` 在 dispose 后调用同一 handler |

### 4. 靶子独立性检查

用户日志是外部报告，Electron 事件顺序由官方文档定义；现有测试只验证拆除函数被调用，没有验证「before-quit 被取消后能力仍在」。本次新增 lifecycle 与 lane 行为测试，测试不依赖生产实现字符串。

### 5. P0：这些是我们独有的吗？现成方案有哪些

Electron `before-quit` / `will-quit` 是平台现成生命周期，直接接入；项目 hydration 的失败隔离属于 Nomi 的工作台领域约束，需要保留在 hydration 边界。官方依据：`https://www.electronjs.org/docs/latest/api/app`。

### 6. 接入 / 补 / 重写 / 删对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 按 Electron 事件语义，把清理接到 `will-quit` | 需要处理异步收尾 | 低 | ✓ |
| 补 | 在 `before-quit` 继续清理并尝试恢复 | 仍可能漏掉新增清理点 | 高 |  |
| 重写 | 新造第二套退出状态机 | 重复 owner | 高 |  |
| 删 | 删除清理 | 残留子进程 / 目录占用 | 高 |  |

### 7. 用户要权衡的核心

退出时宁可多等一次不可取消阶段，也不能让用户得到一个「窗口活着、能力已被拆掉」的残缺进程。

## 特征测试清单（动结构前先锁住现状）

- `electron/agentLane/laneIpc.test.ts`：先新增 dispose 后调用的红测，钉住旧行为会变成 handler 缺失。
- `electron/quitTeardown.test.ts`：先新增 before-quit / will-quit 顺序红测，钉住旧实现把拆除放在 before-quit。
- 项目 hydration 的真实 UI 走查在实现后补；当前没有 NomiStudioApp 的可注入单测 harness，未验证原因记在交货报告。
