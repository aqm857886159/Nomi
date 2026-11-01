# 方向检查：Director Produce 主按钮颜色回潮

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

### 0. 一句话根因

分体主按钮没有共享 Workbench primary 颜色边界，局部组件可以直接把强调色当默认底色，现有门岗也没有识别这类主按钮回潮。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| C-DS33-produce：ProduceButton 默认 `bg-nomi-accent text-white` | 分体外壳自行写颜色，没有复用 primary 契约 | 共享设计 token 边界缺失 |
| 同类颜色回潮没有自动拦截 | token 门岗只检查部分文字 / 描边组合 | 门岗覆盖不足 |

### 2. 为什么这一类会一直出现

这是表示层边界问题，不是某个状态判断漏写：普通主动作的视觉层级没有单一 owner，组件作者可以绕过 `WORKBENCH_BUTTON_VARIANT.primary`。本次改为导出共享 primary class，并把扫描收口到门岗。

| 铁律 | 判断 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 不适用；没有改模型、参数或生成意图 | `tests/ux/design-lab-director-3dbox.walk.mjs` 只核对颜色状态 |
| ⑪ 能选到 | 不适用；没有新增可选参数 | 原有 ProduceButton 状态 union 未改 |
| ⑫ 点了=以为的 | 适用；默认 / 悬停 / 禁用 / 菜单预期写入走查断言 | `board:DirectorProduce/*` 断言与四轨截图 |

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新的分体或浮动主按钮再次直接使用 accent 默认底色 | `rg -n "bg-nomi-accent.*text-white|text-white.*bg-nomi-accent" src --glob '*.tsx'` 并运行 `pnpm run check:tokens` |
| disabled 主按钮仍被 hover 规则染蓝 | 设计实验室走查读取 computed `background-color`，跑 `C_DS33_VARIANT=v1 pnpm exec node tests/ux/design-lab-director-3dbox.walk.mjs` |
| 分隔线 / spinner 在暗色主题不可见 | 运行渲染中 zh/en 暗色截图并核对 `nomi-paper` computed 色值 |

### 4. 靶子独立性检查

实现与验收都由同一协调任务线维护，但靶子不是截图像素：走查读取浏览器 computed style，颜色期望通过 Tailwind token probe 得到；菜单可见、disabled、hover 由独立断言覆盖。没有发现“修对反而掉分”的先例；协调线仍需在本地提交上独立复跑。

### 5. P0：这些是我们独有的吗？现成方案有哪些

按钮状态契约（ink / paper / accent）是 Nomi 的设计系统约束，不是领域算法；通用实现可复用现有 Tailwind token 与 `WORKBENCH_BUTTON_VARIANT.primary`。`gate-family`（`docs/engineering/self-written.json`）仍处 under-review：本次只增加一个窄扫描器，暂不替换整套门岗；评估截止 2026-10-31。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 继续用 Tailwind token / WorkbenchButton primary；参考 `src/design/actions.tsx` | 无新依赖 | 分体几何仍需局部外壳 | **推荐** |
| 补 | 在 `check:tokens` 增加窄的主按钮颜色棘轮 | 维护少量基线 | 扫描器不是完整语义分析 | 作为门岗补强 |
| 重写 | 把所有分体按钮改成通用组件 | 迁移与几何回归成本高 | 破坏菜单 / 宽度合同 | 不推荐 |
| 删 | 删除颜色扫描门岗 | 短期少维护 | 回潮重新无门 | 不采用 |

### 7. 用户要权衡的核心

这次应把“主按钮颜色由共享契约决定”作为结构边界，同时接受分体按钮几何仍保留局部实现；若未来要消灭局部外壳，需要另开组件抽象决策，不能在本次颜色修复里顺手扩大范围。

## 特征测试清单（动结构前先锁住现状）

- 已钉住：`scripts/primaryColorScan.test.mjs`（合规 / 违规反例与注释跳过）。
- 已钉住：`tests/ux/design-lab-director-3dbox.walk.mjs` 的 `board:DirectorProduce/primary*`、`divider-spinner`、`menu` 断言。
- 已钉住：`pnpm run check:tokens` 的 text-white 与 accent+white 棘轮。
- 未钉住：真人任务成绩单与真实用户窗口验收；本次报告标记为未验证，由协调线补验。
