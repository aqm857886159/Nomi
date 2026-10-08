# 设计卡：测试临时目录回收

改动名：L-tempclean；负责人：实现线；类别：其他（测试基础设施）。

## ★ 1 用户怎么用

当开发者或 CI 重复运行 Vitest、Electron 走查或 E2E 时，测试结束后系统临时区不再累积本轮创建的 `nomi-*` 根目录；测试行为和产品界面不变。

## ★ 2 谁说了算

测试基础设施的生命周期由 `tests/setup/tempWorkspace.ts` 和 `tests/ux/_launchApp.mjs` 各自唯一持有；不触碰产品代码或门禁判断。

## ★ 3 一致与复用

复用现有 Vitest `globalSetup` 能力和现有 Electron `launchNomiApp` 启动链；新增的清理只放在共享边界，不复制到各个 walk 脚本。

## ★ 4 全状态

正常通过、断言失败、窗口启动超时、启动异常和进程退出都执行强制且幂等的根目录回收；历史目录不动。

## ★ 9 验收与回滚

回归命令：`pnpm exec vitest run tests/setup/tempWorkspace.test.ts tests/ux/_launchApp.test.mjs --config vitest.config.ts`；契约命令：`node scripts/check-root-cause-contracts.mjs`。回滚为还原本次提交，生产应用无迁移。

### 功能分类

- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] 数据格式 / 测试基础设施
