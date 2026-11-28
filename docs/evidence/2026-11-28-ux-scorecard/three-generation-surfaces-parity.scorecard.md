# 体验成绩单：分镜 · 画布 · 列表三处生成同源收口与编译期穷尽契约

- 改动：分镜 · 画布 · 列表三处生成同源收口与编译期穷尽契约
- 验收 head：`32101208214b90b6bd344d15100c9be913c74977`（产品源码与结构门岗停在该提交；随后提交的仅是本次实测产出的性能原始结果 JSON 与本页体验成绩单，不属于应用构建输入。）
- 场景 id：`three-generation-surfaces-parity`
- 谁验：impl-view-parity（实现线自验，待独立验收线复核）
- 日期：2026-11-28；成绩单整理：impl-view-parity（基于必红目标单测、隔离静默实窗 1440×900 四轨真截图、ui.mjs 真实点击流水与 192 节点性能基准）

**用户这次能完成：**在创作分镜、生成画布、生成列表三处自由切换而不丢任何真实能力：列表空态和有卡片态都能直接新建节点与导入素材；列表大详情直接编辑富文本并按选区 AI 改写、真实播放声音与导出转写 SRT、在结果未知卡区分『重新取回』与『重新生成』、使用与画布同源的内联后处理/上时间轴/定稿工具栏与切主版本宽高回填；在列表点『在画布上点选』自动暂切画布并在点选或按 Esc 后自动回跳原列表详情；分镜切模式保留兼容参数。

**能力变化：**新增：坐标无关的唯一节点内容与动作宿主 NodeStageSurface（canvas / list-detail 双宿主）与 NodeStageHostContext、全部 17 种 GenerationNodeKind 的编译期穷尽能力契约 NODE_SURFACE_CONTRACTS、列表空态与网格顶栏同源新建节点及本地素材导入条 ListCreateBar、切主版本唯一共享领域命令 switchNodeMainVersion（提交白板 + 回填真实宽高 + 一步撤销）、列表发起画布点选自动暂切可见画布并在完成/取消后自动恢复原列表详情的往返状态机；改变：列表大详情采用左 288px 窄轨 + 右居中 600px（NODE_COMPOSER_WIDTH）同中轴舞台，预览区与底部生成框严格共中线、NodeRecoverableReport 与 NodeErrorReport 同源提供『重新取回』与『重新生成』双出口、分镜行与定妆锚切换生成模式时经 resolveModelParams 保留兼容参数、丢弃不适用旧参数，定妆与定稿文案同废弃画布锁解耦、列表投影对已有正文的文本节点及已完成转写文本的语音节点直接标为已完成，不误标未生成；去掉：GenerationListParts.tsx 中手写的只读 4 行截断 TextPreview 与 48 根静态假竖条 AudioStrip、GenerationListDetail.tsx 中的手写 DetailPreview 与裸调 setNodeMainResult 漏回填旁路、ShotComposerBar.tsx 切模式时写 params: undefined 清空兼容参数的分支、散落在 resolveRenderKind.ts 与 generationListModel.ts 中的重复节点种类名单

## 结果

- 机器：完成 **3 / 7**（失败 4 条，原样列在下表，不丢）
- 首次尝试成功：null（未采集：需要真人首次操作，AI 不代填）

| 尝试 | 结果 | 说明 | 证据 |
| --- | --- | --- | --- |
| 必红目标单测（实现前） | **失败** | 编写 threeSurfacesParity.goal.test.tsx 先跑必红，缺少 nodeSurfaceContract 与共享舞台时当场红灯，确认测试有效。 |  |
| 门岗预检：概念归属与词典字面量 | **失败** | check:concept-owners 提示新共享边界需登记且 pending 概念 resolveModelParams 只许在白名单消费者内调用；check:test-copy-literals 拦下测试夹具里的词典原文。将模式参数收口函数归入白名单模块 plannedNodeMeta.ts、补齐概念登记并替换测试夹具字面量后全绿。 |  |
| 合并最新主干后的文件体积与拍板锚点自检 | **失败** | 合入主干零松弛体积基线后 NodeParameterControls.tsx 超 1 行，且新增板元素需绑定标准 data-board 锚点。将列表点选抗卸载保护上提至 enterCanvasPickMode 唯一 owner 边界（零改动调用方组件），并补齐 data-board 锚点后全绿。 |  |
| 首轮 1440×900 实窗截图亲眼审阅 | **失败** | 亲眼 Read 首轮中文浅色真图发现三处体验瑕疵：① 已有正文的文本卡与已出转写稿的声音卡仍显示『未生成』灰标；② 大详情内联工具栏撑满 600px 全宽导致单按钮显得空旷；③ 转写卡套了画幅高框留出多余空白。当场收紧为紧凑居中胶囊工具栏、自然高度卡片与准确完成态后重出全套截图。 |  |
| 最终 1440×900 静默实窗四轨截图与同轴几何断言 | 通过 | zh-CN / en × light / dark 共 20 张 1440×900 真图全部落盘并逐张亲眼核验；大详情预览与底部生成框水平中心差实测 <= 1px；前台抽样全程零抢焦点。 |  |
| ui.mjs 真实用户路径交互验证 | 通过 | 从空项目切列表 → 空态直接点新建文字并输入正文 → 回列表新建图片 → 点『在画布上点选』自动切到可见画布 → 按 Esc 自动回跳原列表详情，全程 0 页面报错。 |  |
| 192 节点规模画布与列表互切性能基准 | 通过 | workbench-switch-canvas-list 连续 5 轮实测在 100ms 预算内，长任务为 0。 |  |

## 机器测的

来源：walk-log
设备 / 窗口 / 语言：macOS arm64，真实隔离静默 Electron 窗口（_quietWalk UIElement，零抢前台焦点） / 1440×900（四轨对比图）与 1280×800（ui.mjs 交互驱动）；浅色 + 深色 / zh-CN / en。边界：本机确定性 SVG/WAV 测试资产与内置模型目录种子，不发真实外网付费请求。

| 主指标 / 指标 | 现状 → 当前 | 单位 | 样本数 | 口径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| setNodeMainResult 生产写入门数量 | 2 → 1 | 扇 | 1 | 脚本计数（真事件，非采集器） | node scripts/door-map.mjs setNodeMainResult 实测：列表详情与画布多版本统一收束至 switchNodeMainVersion。 |
| GenerationNodeKind 视图舞台契约覆盖数 | 0 → 17 | 种 | 17 | 脚本计数（真事件，非采集器） | satisfies Record<GenerationNodeKind, NodeSurfaceContract> 编译期穷尽锁死全部 17 种节点。 |
| 列表大详情预览区与生成框水平中线偏差 | null → 0 | px | 4 | 脚本计数（真事件，非采集器） | 1440×900 四轨（中英 × 亮暗）DOM getBoundingClientRect 中心横坐标差均为 0px（门限 <= 1px）。 |
| 192 节点规模画布 ↔ 列表视图切换响应（中位数） | 53.3 → 48 | ms | 5 | 实测（采集器） | workbench-switch-canvas-list 5 轮实测：中位数 48ms，p95 48.3ms，预算 100ms。 |

## 真人给的（和上面分开记）

- SEQ（1–7）：null（未采集）
- 误点：null · 回退：null · 求助：null · 首次尝试成功：null
- 说明：未采集真人 SEQ 与人工事件观察，按规则记 null。

## 护栏

| 护栏 | 结果 | 证据 / 说明 |
| --- | --- | --- |
| 无只读假文本截断与无 48 根静态假音频条残留 | 通过 | GenerationListParts.tsx 已删除 TextPreview 与 AudioStrip，由 threeSurfacesParity.goal.test.tsx 回归锁死 |
| 结果未知卡不诱导盲目重发多扣费 | 通过 | NodeRecoverableReport 主按钮为免费查已有任务号的『重新取回』，次按钮为走单飞确认的『重新生成』，中英词典零计费承诺词（check:i18n 通过） |
| 列表暂切画布点选不被组件卸载误杀且必回原列表详情 | 通过 | enterCanvasPickMode owner 边界保护 + threeSurfacesParity.goal.test.tsx 2b + ui.mjs 真窗点选 Esc 回跳验证 |
| 分镜切模式不丢失兼容参数且不恢复已废弃的画布节点锁 | 通过 | ShotComposerBar.imageMode.test.ts + NodeFloatingToolbar.test.ts + ESLint node-lock-removed 零违规 |
| 实窗取证全程静默不抢用户前台焦点 | 通过 | _launchApp startMacForegroundGuard 抽样核验 frontPid 始终非走查进程，violated: false |

## 最大摩擦点与决定

- 摩擦：3D 导演台、剪辑时间轴卡、拆片分镜表这三类多节点空间工具依赖整张画布的拖拽连线与宽视口，硬塞进列表大详情 600px 单列会导致严重拥挤与交互残缺。
- 决定：在 NODE_SURFACE_CONTRACTS 中显式声明这三类为 canvas-only，列表网格显示紧凑工具卡、列表大详情展示清晰说明与『去画布』主按钮一步直达并选中该节点，保持『一个东西一个家』。
- 协调决定：待协调（通过 / 退回 / 明示延期）

## 没验证的

| 缺口 | owner | 复查条件 |
| --- | --- | --- |
| Windows 真机窗口渲染与字体排版 | 协调会话 / CI | 当前工作机为 macOS，跨平台单测与构建在 CI Windows 矩阵复核。 |
| 真实外部付费供应商在线生成闭环 | 协调会话 | 本轮按纪律只跑免费本地确定性夹具，不擅自触发外网真实扣费。 |
| 独立验收线盲验与拍板图签章 | 协调会话 | PR 开立后交用户审阅四轨截图拍板，并由独立验收线按 ★9 清单盲验。 |

## 证据路径

- docs/plan/2026-11-28-three-generation-surfaces-parity.md
- docs/fixes/2026-11-28-three-generation-surfaces-parity.root-cause.json
- docs/evidence/2026-11-28-perf/workbench-switch-canvas-list.json
- src/workbench/generation/list/threeSurfacesParity.goal.test.tsx
- src/workbench/creation/storyboard/shotRow/ShotComposerBar.imageMode.test.ts

> 这一页不出总分：机器数、真人数、护栏、未验证各看各的。
