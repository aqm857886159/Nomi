# 单测和隔离窗口不再写创作者真实的能力目录（短版设计卡）

改动名：tests-off-real-capability-dir　类别：其他（纯测试 / 配置，不碰应用代码、不碰界面）

## 短版设计卡

- **★1 用户怎么用**：当开发者 / 验收线跑 `pnpm test` 或起隔离窗口走查，我想让创作者主目录下的能力目录（令牌、实例登记、批准收据密钥）一个字节都不被动，以便不和创作者开着的 Nomi 抢同一份登记。不做：不改应用怎么找能力目录。量具：假主目录下跑整套单测后 `.nomi` 下文件数（修前 3 个：令牌 1 + 批准收据密钥 2，修后 0）；真实目录修改时间前后对比；`scripts/testCapabilityDirIsolation.test.ts`。
- **★2 谁说了算**：「测试用哪个能力目录」只有一个 owner：单测 = `tests/setup/tempWorkspace.ts`（整轮设 `NOMI_CAPABILITY_DIR` 到本轮临时目录，所有 worker 共用）；隔离窗口 = `tests/ux/_launchApp.mjs`（只认显式配置，否则派生到隔离资料目录下，不再继承外层 shell 的值）。起窗入口：`electron.launch` 只有 `_launchApp.mjs` 一处（`check:e2e-launch` 已守）；测试全局配置 `vitest.config.ts` 一份（`vitest.realMedia.config.ts` 同走该 globalSetup 之外的单独车道，不写能力目录）；node:test 车道（`test:node-suites`）未走 vitest，另在假主目录下跑一遍核实。
- **★3 一致与复用**：此前是「每条测试自己 `vi.stubEnv` 补」（约二十条已补），漏的两条是 `mcpHttpPortConflict`（调 `ensureToken()`）和 `mcpStdioDocumentReceipt`（批准收据密钥）；沿原方向补第三条是修补，选「换到最早共享处」：全局设一次，各条 stub 保留无害。事后断言复用同一个 globalSetup，不新增门岗登记。
- **★4 全状态**：不涉及用户可见状态；失败时开发者看到 globalSetup 的一句中文报错（默认能力目录被改动）。创作者的 Nomi 开着时它自己改该目录会让事后断言误报：报错里写明先关 Nomi。
- **★9 验收与回滚**：验收清单与反例：① 删掉全局配置里那行设能力目录 → 守卫测试红、假主目录下目录冒出来；② 起窗助手改回继承外层值 → 守卫测试与 `e2e-launch-capability` 红；③ 外层设一个值再起窗 → 窗口用自己的派生目录；④ 手写绕过（清环境变量写默认路径）→ 事后 stat 断言红（拦得住「事后发现」，拦不住「事前阻止」）；⑤ 不改 HOME 整套单测前后真实目录修改时间不变。回滚：revert 本提交。
