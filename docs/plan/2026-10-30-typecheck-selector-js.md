# 类型检查选择器遵循真实 program 根文件

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

类别：其他（门岗脚本修复）；不涉及花钱、长跑、可打断或新界面。

| 格 | 决定与验收量具 |
| --- | --- |
| ★1 用户怎么用 | 开发者修改文件 → 提交 → 推送前选择门岗 → 执行 typecheck → 根据结果修正。被真实 program 覆盖的 JS 应与 TS 一样选中。主指标：被覆盖根文件的选择命中率 100%；护栏：未覆盖脚本的误选率 0%；量具：`scripts/pre-push-structure.node-test.mjs` 的临时 tsconfig 夹具及原有真实 tsc 探针。任务覆盖 CJS 单独修改、未覆盖 MJS 单独修改、原有 TS / 配置 / side inputs；不扩张 tsc 覆盖，不修改源码扫描门岗。连带界面不适用：没有 UI。 |
| ★2 谁说了算 | 概念登记 `delivery.typecheck-coverage`；类型检查范围唯一 owner 为 `TYPECHECK_PROJECTS` 展开的 `typecheckCoveredFiles`；配置与 side inputs 保留既有显式规则。删除选择器的扩展名预过滤，不复制 TypeScript 的扩展名表。数门：`touchesTypecheck` 生产调用方 1 个（gate-inputs），`typecheckCoveredFiles` 生产调用方 1 个（共享选择器）；wrapper `touchesGateInputs` 共 3 个文件（生产 1、测试 2）。量具：`node scripts/door-map.mjs --read=<符号> --roots=src,electron,scripts,tests --include-tests`。 |
| ★3 一致与复用 | 复用 TypeScript 的 `readConfigFile` / `parseJsonConfigFileContent`，通过集合成员身份选择任意真实根文件，沿用现有共享缓存。代码扫描用的 TS 扩展名清单用途不同，不动；不加依赖。量具：仓库检索及门表，回归覆盖 JS / JSX / MJS / CJS 四种形状。 |
| ★4 全状态 | 空改动返回 false；覆盖根文件返回 true；未覆盖文件返回 false；配置 / side inputs 返回 true；读取配置失败继续抛错阻断，不当作无覆盖。加载、部分成功、取消中、过期、能力不可用不适用：同步门岗判定，无 UI、外部服务或持久状态。量具：选择器回归与完整 gates。 |
| ★9 验收与回滚 | 先在未改生产代码时运行夹具，确认 CJS 属于展开根文件但选不中（红）；删除预过滤后同一命令转绿。清单：四种 JS 根文件各自单独改命中；未覆盖 MJS 单独改不命中；混合输入含已覆盖根文件命中；原 TS、任意 tsconfig、shared config、side inputs 保持；原真实 tsc 探针不改；空输入不命中；门表没有第二个选择器。执行结构用例、`check:root-cause-contracts`、`pnpm run gates`、带 PR 正文的推送前快检；重活按 Mac 门岗锁纪律。独立验收不适用：门岗脚本，非四类。回滚：revert 本次修复提交，原选择漏洞会恢复。 |

症状：allowJs program 的 JS 根文件单独修改漏跑 typecheck。直接原因：扩展名过滤在查真实覆盖集合之前丢弃 JS。类根因：选择器维护手写候选表与真实编译范围两份真相；结构性预防是删掉候选表。

验收记录：修前夹具的 CJS 根文件成员断言通过、选择断言失败（退出 1）；修后相同夹具通过，完整结构用例 46/46；源文件只删除扩展名预过滤，原真实 tsc 探针未修改。新增 owner 登记经 `node scripts/check-concept-owners.mjs` 验证通过。
