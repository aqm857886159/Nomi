# C76 实施证据

#689 已批准；按 03:10/04:32 裁决仅改外框。生产内部布局代码不动，样张画错的发送按钮左置没有实施。

| 样张规格 | 生产结果（light / dark） | 结论 |
|---|---|---|
| radius 10px | 三栏 `rounded-nomi`，实测10px | 一致 |
| 四边1px、nomi-line | 三栏同一共享 frame | 一致 |
| paper 底色、无阴影 | token 随主题翻转；shadow-none（computed 为透明零尺寸阴影） | 一致 |
| header 48px、水平12px、垂直0 | 三栏同一共享 header，实测48px | 一致 |
| 轻分隔线 | border-nomi-line-soft | 一致 |
| 外框不叠内容 padding | 内部列表/编辑器/Agent 各自内距不变 | 一致 |
| 四周、栏间16px | x=16/272/1034，y=72，h=812 | 一致 |
| overflow-clip | 三栏 frame；正文/对话现役滚动区保留 | 一致 |
| 栏内控件保持原排列 | [完整几何 diff](geometry-diff.md)，37控件×2主题 | 通过 |
| 其它工作区保持原样 | 同窗口切分镜 header=40px、回创作=48px；Agent body SSR 完全相同 | 通过 |

[改前浅](before-light.png) / [改后浅](after-light.png) / [改前暗](before-dark.png) / [改后暗](after-dark.png)。原始坐标见同名 JSON。`check-geometry.mjs` 按 04:32 已批位移逐控件断言，非法相对移动或次序改变报红。

仅更新以下完整基线名；实验室已删除外框 selector 覆盖，直接展示生产组件，撤销 creation-columns 待批豁免：

- `creation-columns/columns-current.png`
- `creation-columns/columns-specimen.png`
- `creation-columns/columns-specimen-dark.png`

## R13 单窗口真实任务

隔离 Electron，复制本机加密模型配置，无项目夹具、无运行时状态注入、无 loopback。UI 新建项目、输入两段、在模型下拉选 DeepSeek V4 Flash、点拆分镜并发送 → 给出三镜建议；再要求保存 → 点击确认 → 实际 project.json 有「雨夜车站」3镜；最后发送一句节奏建议并收到一句回答。模型第一次只给建议，需补一句保存，这是本次真实观察，不能称首回合就完成落盘。仅外框任务不改 Agent 行为。

工具调用成功3/3，写工具成功1/1；3/3回合 completed；人工确认1次；分镜首次落盘目标1/2回合。真实文字模型3回合，trace估算费用 $0.040484504（非账单），图片/视频生成0次。[脱敏收据](journey-receipt.json) 含输入、输出、工具和usage；原始转录在收据记录的隔离 profile。

[确认后](journey-confirmed.png) / [最终一句话](journey-final-light.png) / [打开分镜](journey-storyboard.png)。主会话已目视核验明暗、实验室与生产：外框对齐，无发送按钮移位；切分镜使用原有外框。信息密度：最终屏无额外说明行、无重复状态行、无失败警告；第一次分镜建议较长但属于现有模型输出。

复现：启动 renderer :5273、构建 Electron，运行 `node docs/design/creation-columns-evidence/implementation/capture.mjs after`，然后 `node docs/design/creation-columns-evidence/implementation/check-geometry.mjs`。截图基线命令只选 `--grep creation-columns`。
