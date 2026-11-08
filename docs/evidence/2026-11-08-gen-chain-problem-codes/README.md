# 起草拒收原因：修前 / 修后

日期：2026-11-08。修前源码：`0fdd0da72e9be98430b300e491b6bd47f7d79976`（最新 main 的 detached 构建）；修后生产源码：`eb44f5ba9`。两边均完成完整开发构建，Electron 43.4.1、Node 24.18.1，视口 1280 × 933。

16 张原始 Electron 截图已逐张查看：每边三种真实起草拒收 × zh/en，加参考上限的 zh/en 夹具帧。三种请求均通过生产 draft_shots 路径、写入真实 lane 转录并由真实面板显示；对话模型由 loopback 脚本驱动，不证明真实模型会自行改对。两边各 3 次工具拒收、0 个画布节点、0 次生成请求、0 次付费。

观察：修前模型不存在与无默认共用笼统句；比例错误已有 aspectRatio 字段和六项可选值，展开体仍含笼统句。修后按原因说明，比例展开只列前四项加「等」/ “etc.”，默认模型展开指到模型菜单。unknown_model 的失败行和展开详情没有 nearest 的 id 或显示名。默认模型的截图覆盖图片分支；视频分支由中英文单测覆盖。

四张 reference_over_capacity 图在画面与文件名上标明「夹具 / FIXTURE」：关闭隔离 App 后，仅向第一条失败信封注入上限 4 的 problem，再冷启动渲染。它们证明面板渲染，不代表生产起草会抛出真实超量。真实抛出点由 generationProblemCodes.test.ts 的容量夹具覆盖，生产提交期超量仍归后续请求链改造。

走查：`tests/ux/agent-generation-problem.walk.mjs`；修前设置 `GENPROBLEM_REPLAY=before`，修后设置 `GENPROBLEM_REPLAY=after`。启动前分别记录 SecurityAgent，外层每 30 秒监控并在发现新进程时终止自有进程；本次基线及结束均为空，修前一次周期检查也为空。修后运行不足 30 秒。未访问真实资料或真实凭据。

## 文案对照

未截图的码在表中明确列出；时长以范围、枚举、不接受时长分别说明，另覆盖只有单边界的形状。未截图的修前句子按旧面板规则列出，不冒充视觉证据。

| 码 | 修前面板说什么 | 修后（zh / en） | 下一步指向 | 截图文件名（修前、修后） |
|---|---|---|---|---|
| `unknown_model` | 这个模型不接受这组参数，这一步没有执行。 / This model does not accept these settings, so the step did not run. | 没有这个模型，这一步没有执行。 / There is no such model, so the step did not run. | Agent 按 Next 使用目录中真实存在的近似项或 list_models；面板不显示近似项。 | `before-01-zh-unknown_model.png`、`before-01-en-unknown_model.png`；`after-01-zh-unknown_model.png`、`after-01-en-unknown_model.png` |
| `no_default_model` | 这个模型不接受这组参数，这一步没有执行。 / This model does not accept these settings, so the step did not run. | 没有能用的默认图片模型，这一步没有执行。 / No usable default image model, so the step did not run.<br>没有能用的默认视频模型，这一步没有执行。 / No usable default video model, so the step did not run.<br>在模型菜单选一个具体模型。 / Pick a specific model in the model menu. | 面板：在模型菜单选一个具体模型。Agent：也能从 list_models 点名 candidate。 | `before-03-zh-no_default_model.png`、`before-03-en-no_default_model.png`；`after-03-zh-no_default_model.png`、`after-03-en-no_default_model.png` |
| `mode_not_in_model` | 无字段时为笼统拒收句；带字段时按旧字段提示（此码本轮无修前截图）。 | 这个模型做不了这种镜头，这一步没有执行。 / This model can’t make this kind of shot, so the step did not run. | Agent 换成 allowed 中的模式或从 list_models 换模型。 | 此码未截图；对应中英文单测覆盖。 |
| `ratio_not_in_mode` | 行尾：参数没填对：aspectRatio · 要填 1:1、4:3、3:4、16:9、9:16、3:2… 之一。 / Wrong argument: aspectRatio · use one of 1:1, 4:3, 3:4, 16:9, 9:16, 3:2…；展开体另带笼统拒收句。 | 这个模型出不了这个画幅比例，这一步没有执行。 / This model can’t make that aspect ratio, so the step did not run.<br>这个模型不能选画幅比例，这一步没有执行。 / This model has no aspect-ratio choice, so the step did not run. | 有比例档时展开列前四个加等 / etc.；没有比例档则 Agent 去掉 aspectRatio。 | `before-02-zh-ratio_not_in_mode.png`、`before-02-en-ratio_not_in_mode.png`；`after-02-zh-ratio_not_in_mode.png`、`after-02-en-ratio_not_in_mode.png` |
| `duration_not_in_mode` | 无字段时为笼统拒收句；带字段时按旧字段提示（此码本轮无修前截图）。 | 时长要在 {{min}}–{{max}} 秒之间，这一步没有执行。 / Duration must be {{min}}–{{max}} seconds, so the step did not run.<br>时长只能选 {{values}} 秒，这一步没有执行。 / Duration can only be {{values}} seconds, so the step did not run.<br>这个模型不能设时长，这一步没有执行。 / This model doesn’t take a duration, so the step did not run.<br>时长至少 {{min}} 秒，这一步没有执行。 / Duration must be at least {{min}} seconds, so the step did not run.<br>时长最多 {{max}} 秒，这一步没有执行。 / Duration must be at most {{max}} seconds, so the step did not run. | Agent 用合法范围 / 档位；无时长设置则去掉 durationSec；范围、列值、不能设各一句。 | 此码未截图；对应中英文单测覆盖。 |
| `reference_over_capacity` | 这个模型不接受这组参数，这一步没有执行。 / This model does not accept these settings, so the step did not run. | 参考素材最多 {{max}} 个，这一步没有执行。 / This model takes at most {{max}} references, so the step did not run. | Agent 减少参考至上限；这里只证明抛出点和夹具渲染，不证明生产超量。 | `before-04-zh-FIXTURE-reference_over_capacity.png`、`before-04-en-FIXTURE-reference_over_capacity.png`；`after-04-zh-FIXTURE-reference_over_capacity.png`、`after-04-en-FIXTURE-reference_over_capacity.png` |
| `reference_role_not_in_mode` | 无字段时为笼统拒收句；带字段时按旧字段提示（此码本轮无修前截图）。 | 这个模型不接这种参考用法，这一步没有执行。 / This model doesn’t take a reference used that way, so the step did not run. | 展开列前四个合法参考用途；Agent 改用途。起草路径暂无生产抛出点。 | 此码未截图；对应中英文单测覆盖。 |
| `parameter_not_allowed` | 保持原字段提示；无字段时为笼统拒收句。 | 保持原字段提示；无字段时仍用笼统拒收句。 | 按原字段与合法值指路；结构性拒收使用 field/detail，不新增第九个码。 | 此码未截图；对应中英文单测覆盖。 |

## 验证范围

- typecheck 五份、check:i18n 通过；相关 12 个测试文件 180 passed、1 条原有 expected fail。
- check:walkthroughs、check:walkthrough-tool-args、check:root-cause-contracts 通过；预推送快检通过（67.7 秒）。
- 真实 0.24 旧失败信封记录：未验证。仓库证据与版本对比评测的 195 个 JSONL 未找到该类信封；保留旧形状单测，不能替代旧数据回放。
- 真实模型 39 题改对率、生产真实参考超量、独立验收：未验证。
