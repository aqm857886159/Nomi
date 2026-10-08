# 退出排空单一 owner 设计卡

改动名：退出排空与关窗确认归一到 quitTeardown
负责人：实现线
类别：可打断

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成结果
- [ ] 数据格式

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 用户点退出或关窗；有未保存内容时仍先问一次，渲染层失联最多等待总退出预算后按确认关闭。 | `electron/windowCloseConfirmation.ts`、退出矩阵测试 |
| ★2 谁说了算 | 主进程 `quitTeardown` 是退出状态和总时限的唯一 owner；任务、Antigravity、视频、截图、watchdog、catalog 只登记 drain。 | `electron/quitTeardown.ts`、door-map |
| ★3 一致与复用 | 所有可排空工作使用同一登记接口，required/optional 和单项截止时间显式声明；不保留调用方退出状态机。 | `electron/quitTeardown.ts`、ESLint 结构守卫 |
| ★4 全状态 | 正常完成、抛错、永不 resolve、重复退出、关窗取消后再退出均在总预算内结束；取消关窗不释放运行资源。 | `electron/quitTeardown.test.ts`、`electron/windowCloseConfirmation.test.ts` |
| ★9 验收与回滚 | 运行相关 Vitest、静态守卫、`pnpm run build`；回滚为恢复旧实现，但旧的多 owner 监听不得与新实现并存。 | 测试命令与提交 diff |

### 设计决定

`quitTeardown` 维护一个全局退出请求标记、登记表和总预算。所有 drain 并行启动；required drain 在自己的截止时间内完成，否则 owner 直接 `app.exit(0)`；optional drain 超时只记录错误，不阻塞退出。owner 成功后只由它调用 `app.quit()`。

窗口确认继续由渲染层回答以保住“有未保存内容时问一句”。请求在 owner 总预算内无回复时按确认关闭；明确拒绝会清掉退出请求标记并保留窗口和运行资源。这样渲染层失联不会成为永久阻塞。

