# 体验成绩单：「自动」处处写明实际模型名 + 默认模型设置收成图片 / 视频 2 行

- 改动：「自动」处处写明实际模型名 + 默认模型设置收成图片 / 视频 2 行
- 验收 head：`见提交说明（本分支 feat/s-g-auto-model-explicit 的提交接在 80ee6d190 之后）`（实现线 impl-s-g-auto-model 自测与实窗取证；走查与性能场景均在最新构建上实跑）
- 场景 id：`canvas-image-generate`
- 谁验：impl-s-g-auto-model（实现线自测；独立验收线待协调指定）（实现线自测）
- 日期：2026-11-28；成绩单整理：impl-s-g-auto-model，按本次走查日志、实窗驱动记录与性能场景原始结果填写

**用户这次能完成：**在画布新建图片或视频节点时一眼看到「自动 · 实际模型名」（不随上一张卡手选带偏，加参考图切改图名字不变）；在设置 › AI 策略用「图片 / 视频」2 行统一管理默认模型，并在首选不可用、单能力手选或零可用模型时看到诚实回退与接入入口

**能力变化：**新增：唯一「自动」解析真源 src/config/autoGenerationModel.ts（推荐梯队 + 本机可用连接 + 供应商偏好序 + 近期连败避让）、设置下拉首项 policy.picker-auto-option 与节点模型下拉首项 node.picker-auto-option（带副标与分隔线）、单能力手选提示 edge.single-capability-pick、供应商降级显示 edge.vendor-fallback、零模型空态「去接入供应商」edge.none-available；改变：设置 › AI 策略「新建节点默认用哪个模型」从 4 行收成「图片 / 视频」2 行（schemaVersion: 2）、画布新建节点左下模型胶囊默认印「自动 · 实际模型名」（窄生成框放不下时参数胶囊自动换行，模型名不截断）；去掉：新节点跟随上一张卡记忆（lastGenerationChoice / rememberGenerationChoice）、旧 4 行按子任务拆分的默认模型设置界面与 schemaVersion: 1 迁移包袱（SG-3 升级回到自动）

## 结果

- 机器：完成 **3 / 5**（失败 2 条，原样列在下表，不丢）
- 首次尝试成功：null（未采集：需要真人首次操作，AI 不代填）

| 尝试 | 结果 | 说明 | 证据 |
| --- | --- | --- | --- |
| default-generation-model 走查第 1 次 | **失败** | InlineParameterBar 中 autoWrapOnCramp 引用了后声明的 fitStep 触发 TDZ，导致生成框底栏未挂载；已将 autoWrapOnCramp 移至 yieldStep 之后并重编通过 | src/workbench/generationCanvas/nodes/InlineParameterBar.tsx |
| default-generation-model 走查第 2 次（修复后） | 通过 | 8 条判据全绿：未设默认时新卡印「自动 · GPT Image 2.5 Sunburst」，设置图片默认后新卡继承且已有卡不被改写，schemaVersion 2 双段身份落盘 | tests/ux/default-generation-model.walk.mjs |
| composer-bar-yield-calibration 走查（画布 / 列表 / 分镜 / 锚点 × 中英） | 通过 | 8 组校准全部 PASS，自动态不截断换行未破坏手选模型底栏让位精度 | tests/ux/composer-bar-yield-calibration.walk.mjs |
| ui.mjs 实窗取证第 1 次（直接按文本点折叠区外 Z-Image Turbo） | **失败** | 17+ 模型下拉有滚动折行，未先在「搜模型」输入框过滤时底部项不在可视区；改为经搜索框输入 Z-Image 过滤后点击 | src/workbench/settings/DefaultGenerationModelsSection.tsx |
| ui.mjs 实窗取证第 2 次（中英 × 亮暗 × 宽窄窗 + 边界全态） | 通过 | 完整覆盖设置 2 行自动态、搜索下拉首项、单能力手选态、Kie 降级态、无可用模型跳转模型页、画布节点生成框及英文窄生成框自动换行 | docs/design/boards/2026-11-27-auto-model/AutoModel.board.json |

## 机器测的

来源：walk-log
设备 / 窗口 / 语言：Mac（Apple M5，10 核，16GB），生产构建产物，隔离静默窗口（不抢前台） / 1280×800 标准视口与 700×720 最小窄窗（列表内联生成框） / zh-CN 与 en，light / dark 双主题。边界：隔离临时资料目录 + fake-apimart 假供应商 / Kie 占位钥匙 / 空资料三档；全程零外网请求、零真实付费

| 主指标 / 指标 | 现状 → 当前 | 单位 | 样本数 | 口径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 设置 › AI 策略需要配置的默认模型行数 | 4 → 2 | 行 | 1 | 脚本计数（真事件，非采集器） | 从文字出图 / 改图 / 文字出视频 / 图片出视频 4 行收成图片、视频 2 行（SG-1） |
| 新建画布卡片看清实际将运行模型所需额外点击 | 1 → 0 | 次 | 1 | 脚本计数（真事件，非采集器） | 改前只印「自动」或跟上次变，需点开看；改后左下胶囊直接印「自动 · 实际模型名」 |
| 200 模型规模下点开生成框模型菜单首反馈时延（中位数） | 40.9 → 65.2 | ms | 5 | 实测（采集器） | perf:scenarios composer-open-model-menu-models-200 --measure-only；p95 65.4 ms，长任务 0 个，预算 100 ms |

## 真人给的（和上面分开记）

- SEQ（1–7）：null（未采集）
- 误点：null · 回退：null · 求助：null · 首次尝试成功：null
- 说明：未采集真人试用数据，按规矩填 null

## 护栏

| 护栏 | 结果 | 证据 / 说明 |
| --- | --- | --- |
| auto.name-is-what-runs：胶囊与下拉印出的模型名和实际落入 node.meta 执行的模型完全同源 | 通过 | src/config/autoGenerationModel.test.ts、src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.test.ts |
| auto.no-name-for-unusable：首选本机不可用时印本机实际可用模型；0 可用时印「暂无可用模型」并给接入入口 | 通过 | src/workbench/settings/DefaultGenerationModelsSection.test.tsx、实窗截图 06 / 07 |
| SG-2 / SG-3：单张卡手选不带偏后续新建卡；旧 schemaVersion 1 四键读取不崩且回到自动 | 通过 | tests/ux/default-generation-model.walk.mjs、electron/settings/generationModelDefaultsContract.test.ts |
| boundarySheet：自动态长模型名胶囊不截断，窄生成框参数胶囊自动换到下一行 | 通过 | 实窗截图 08-node-composer-narrow（700×720 英文列表内联生成框） |

## 最大摩擦点与决定

- 摩擦：用户若在设置页手选了仅支持单一子能力的模型（如 Z-Image Turbo 只能文字出图），之后在画布加参考图改图时该模型无法执行改图
- 决定：不拦截手选，在图片行副标直接诚实写明「只能文字出图；改图时用自动（实际模型名）」，画布改图时无缝回退自动最强模型且不弹假断连告警
- 协调决定：待协调验收

## 没验证的

| 缺口 | owner | 复查条件 |
| --- | --- | --- |
| 真人首次尝试 SEQ 与人工事件计数 | 协调会话 | 真人创作者试用后补录 |
| AI 用户走查（Stagehand 工具未建，且需付费模型） | 协调会话 | Stagehand 走查工具落成后复查 |

## 证据路径

- tests/ux/default-generation-model.walk.mjs
- tests/ux/composer-bar-yield-calibration.walk.mjs
- docs/evidence/2026-11-28-auto-model-perf/composer-open-model-menu-models-200.json
- docs/plan/2026-11-28-s-g-auto-model-explicit.md
- docs/design/boards/2026-11-27-auto-model/AutoModel.board.json

> 这一页不出总分：机器数、真人数、护栏、未验证各看各的。
