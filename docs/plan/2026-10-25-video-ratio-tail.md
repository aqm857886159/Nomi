# 设计卡：视频比例尾巴收口

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：视频比例控件身份与等价比较收口  线/负责人：fix/video-ratio-tail  类别：[其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者在画布上选清晰度、连入参考图或切换模型时，我想让比例规则只看真正的比例控件，以便 960P 不会清空比例、竖图不会生成横片、像素档仍发供应商原值。真实任务：Agnes Video 2.5 选 960P 后连竖图；Runway Gen-4 Turbo 空输入与连竖图各建一次。主指标：同类控件身份判定一致率 100%；质量指标：16:9/9:16 档在全目录可落地率 100%；护栏指标：清晰度/分辨率控件不写 aspect_ratio、不写用户显式标记。量具：`src/workbench/generationCanvas/nodes/controls/parameterControlModel.test.ts`、`src/workbench/generationCanvas/store/canvasConnectVideoAspect.test.ts`、`electron/shared/aspectRatioValue.census.test.ts`。不做界面布局、文案或供应商传输协议变更。已知坑：像素串必须保留原样发送，不能把 `1280:720` 改写成 `16:9`。 | 上述测试与 `electron/shared/aspectRatioValue.ts` |
| ★2 谁说了算 | “什么控件是比例控件”和“两个比例是否同一比例”由 `electron/shared/aspectRatioValue.ts` 唯一负责；`aspectRatioControlsOf` / `aspectRatioControlKey` 负责语义身份，新增约分等价比较函数负责比较；节点 meta 的历史键读取仍由共享的 `ASPECT_RATIO_META_KEYS` 负责。消费者是参数控件模型、参数面板、视频默认派生和画布读值。事实只保留一份，旧别名数组删掉。 | `node scripts/door-map.mjs ...` 输出与代码导入关系 |
| ★3 一致与复用 | 复用现有 `optionsAreAspectRatios`、`aspectRatioControlsOf`、`aspectRatioControlKey`，在 shared 层补一个按约分比较的纯函数；删除 `NodeParameterControls.tsx` 的按键名 Set、`parameterControlModel.ts` 的重复比例别名和字符串相等匹配。领域约束是“比例控件可由值或标签识别、像素档保留原值”，通用判定不另写。 | `electron/shared/aspectRatioValue.ts`、`git grep ASPECT_RATIO_*` |
| ★4 全状态 | 空：没有比例控件时返回空 patch；加载：沿现有模型控件加载，不新增状态；成功：写入匹配档位的供应商原值并同步规范化 `aspect_ratio`；失败：未提供目标比例时保留档案默认；部分成功：只在唯一比例控件找到对应档时写入，否则不改；取消中：不适用，本修复不改可取消流程；过期：不适用，纯函数按当前控件输入计算；能力不可用：模型没有比例选择时保持无比例，不伪造控件，下一步是选择支持比例的模型。文案不变，zh/en 走现有界面。 | 现有纯函数测试、`pnpm run check:i18n`（本线不改文案） |
| ★9 验收与回滚 | 实现线自验：运行参数模型、画布连线、共享普查测试，类型检查、changed lint、根因合同、board parity；逐项反例见下表。独立验收：待协调派验收线，使用同一命令核中英文链与真实任务脚本。回滚：revert 本提交。 | 命令与报告 `/Users/aoqimin/Nomi-coord/Nomi-service/coord-handoff/reports/I-ratio-tail.md` |

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [ ] 新增功能 / 性能

### ★9 验收清单与反例（动手前锁定）

| 验收项 | 反例（入口 / 形状 / 边界 / 版本） | 预期 |
|---|---|---|
| Agnes 960P | 参数入口；`size=960P` 清晰度，另有 `aspect_ratio`；模型默认 | 不清空 `aspect_ratio`，不写 `aspect_ratio_user_set` |
| Runway 无输入 | 默认派生入口；`aspect_ratio` 选项为 `1280:720` 等像素串 | 选 `1280:720`，发出值保留像素串 |
| Runway 全竖输入 | 连线入口；上游 `9:16`；当前模式只有图生视频 | 选 `720:1280` |
| 像素档等价 | 值是 `1280:720`、请求是 `16:9`；约分后相等 | 能选中档位且不改值的写法 |
| 非比例 size | `size=720P/2K/1024x1024`；参数/目录两条入口 | 永不被当比例 |
| 全目录 | 变体、供应商分层、视频模式 | 每个比例控件的 16:9/9:16 档均可落地；无比例控件拒绝 |
| 当前生成方式输入边 | 只发布图生视频模型；连接参考图 | 模型清单按当前生成方式取，目录取法变异测试变红 |
| 派生顺序 | 先切生成方式、再按当前边算比例 vs 反过来 | 测试钉住当前实现顺序，顺序变异测试变红 |

自验记录采用“反例 → 结果 → 证据”表写入任务报告。

### 实现线自验记录

| 反例 | 结果 | 证据 |
|---|---|---|
| Agnes `size=960P` | 通过：只写 `size`，不写比例或显式标记 | `parameterControlModel.test.ts` |
| Runway `1280:720` / `720:1280` | 通过：横图保留 `1280:720`，竖图落 `720:1280` | `canvasConnectVideoAspect.test.ts` |
| 非比例 size / 分辨率 / 质量 | 通过：共享语义判据返回非比例，默认 patch 为空 | `aspectRatioValue.census.test.ts`、`parameterControlModel.test.ts` |
| 只发布文生视频模型连参考图 | 通过：当前生成方式清单查不到时不改比例 | `canvasConnectVideoAspect.test.ts` |
| 派生顺序变异 | 通过：交换两步后 1 格红 | git archive 变异副本日志 |
