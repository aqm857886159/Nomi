# 第八批夜跑走查现役契约同步（#1121）

## 短版设计卡

### ★0 先查别人

- `src/ui/onboarding/OnboardingWizard.tsx:439` · 自定义中转先保存连接，再进入手动模型选择 · 保留空列表、分类、勾选及确认的真实链路。
- `src/ui/onboarding/ModelPickerScreen.tsx:420` · 确认按钮按当前选中数提交，下一屏交给请求格式适配 · 用词典定位数量，用适配页或持久化记录读回提交结果。
- `src/workbench/ai/v4/AgentPanelV4Consent.tsx:41` · 范围升级由启用状态、旧范围和本机已询问记录共同决定 · 给旧用户夹具接入回环文本模型，打开面板空态后验升级和重载。
- `electron/agentLane/laneIpc.ts:208` · Agent 失败回执分开报告错误码与诊断文字 · 验证明确的技能缺失码、零供应商请求及历史指纹不变。
- `electron/projects/projectsIpc.ts:88` · 主进程记录保存拒绝的结构化原因，界面走独立的失败反馈和日志转发 · 若同一诊断包可读回两条相关记录，以原因的主人验锁忙并独立验渲染转发。
- `src/workbench/assets/AssetLibraryPanel.tsx:529` · 可聚焦的素材面板接收拖入和粘贴 · 从现役抽屉内容区定位接收者，用不同内容检验两次落盘的原始文件哈希。
- `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx:258` · 画布仅挂载视口内的节点 · 用画布文档校验拆镜结果与组成员，适应视口后核截图。
- `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:434` · 提示词区具名并以 React Flow 的 `nowheel` 隔离节点编辑区 · 量真实滚动口和视口变换，验证空白画布仍有滚轮反馈。

出口：`tests/ux/_shell.mjs:173` · 共享入口按模型设置当前折叠状态进入接入流程 · 走查复用该入口，并用现役空清单出口继续验证手填模型。

- ★1 夜跑应在真实隔离窗口报告产品旅程的成败。量具为每条脚本的退出码、可见控件断言、业务 IPC 或磁盘读回，以及源码树守卫和进程清单。批准纳入的走查须有修前红、修后绿和零付费请求证据。旧用户条件以各走查隔离种子验证，无生产数据迁移。
- ★2 `door-map` 扫描生产与走查，枚举共享设置入口、工具栏、节点生成框和 lane 删除。两处代表性结果是 `openCustomApiWizard` 有六个走查调用点，`deleteLane` 从 `useAgentPanelV4Actions.ts` 进入客户端。资产入口从 `_shell.mjs` 追到 `AssetLibraryPanel.tsx`，Agent 模型工具名从文稿能力登记追到真实回合。生产边界拥有行为，走查拥有断言和证据。
- ★3 属 recurring 测试契约漂移。最早可拦的是走查编写时复用动作入口和观测锚点，旧脚本自行抄文案、布局和 IPC 别名，静态门岗只验证已有的目录与测试规则。采用共享入口、词典、生产回执字段与仓外分配器替换旧观察点。生产适配和删除走查两条路都会失去有效覆盖，已删除功能与真回归保留红灯。依赖生命周期不适用，本批只改测试消费者。下次夜跑复查纳入项失败是否为 0，量具为逐条退出码和失败归因，复查日 2026-11-26。
- ★4 保留用户能观察的初始态、变更和持久化结果。供应商和模型发现只用回环或现役网络闸，诊断、权限、会话、素材和编辑在真实 Electron 中完成。额度 0。项目切换仍须先建立 B 的保存基线，A 结果落回 A 且 B 指纹不变。拆镜头仍须验证灵敏度、三个真实缩略图和落画布数量。
- ★9 量具为逐条隔离窗口运行、树守卫、`git status --porcelain`、进程前后差集及定向门岗。反例一：确认按钮少选或漏提交一个模型，精确选择数和结果读回应红。反例二：遥测提前放行或升级后仍拦全部，升级前后同一事件入队断言应红。反例三：删除后残留旧回合、冷启复活或重用旧工具结果，盘上指纹与首轮供应商报文应红。反例四：原生拖入事件没有派到接收者，第二张同名同哈希图片落盘断言应红。反例五：运行时去掉滚动裁切，提示词无法内滚。移除滚轮隔离标记后，同一手势会改变画布视口。回滚用 `git revert` 此测试提交。

## 本机验证

基线为 `8ac07cffb` 的真实 Electron 构建。十条原脚本均退出 1。基线执行仅在进程内将旧证据路径重定向到仓外，保留原脚本内容和业务步骤。每次串行启动隔离资料。每条结束后检查源码树、`git status --porcelain` 前后快照及本工作树 Electron 进程差集。以下证据索引相对于本次仓外日志目录。

| 走查 | 原脚本红灯 | 修后真实窗口的结果与日志 |
| --- | --- | --- |
| `model-pick-confirm` | 等不到保存前的旧「手动选择／选择模型」按钮 | 退出 0。中英均保存连接、手填四类共五项，减到四项后进入适配，排除项未提交。见 `rerun-model-pick-confirm/run.log`、`rerun-model-pick-confirm-en/run.log`。 |
| `telemetry-scope-reconfirm` | 旧走查未叫出面板，未接文本模型时面板显示接入卡 | 退出 0。两种语言同一事件在范围 1 拒绝入队，点同意到范围 2 后入队，重载后卡消失。回环模型请求 0。见 `rerun-telemetry-scope-reconfirm/run.log`。 |
| `composer-long-prompt` | 3/21 项失败，沿用迁移前的修饰键和滚轮接管预期 | 退出 0，22/22 项。长提示词可滚、底栏仍在卡内，卡内手势保护视口，空白处滚轮仍生效。去掉裁切和去掉滚轮标记的两个变异都被量具观测到。见 `fixed-composer-long-prompt/run.log`。 |
| `shot-cuts` | 灵敏度和缩略图通过，但视口外节点没有挂在 DOM 上，只计到 1 个新节点 | 退出 0。真 ffmpeg 检出三个切点，滑杆可在 0 和 3 项间切换，三个新图片结果属于同一组，适应视口后截图可见三张。见 `fixed-shot-cuts/run.log`。 |
| `asset-library-native-import` | 粘贴、拖入夹具字节完全相同，现役内容去重只落一张 | 退出 0。拖入派到素材抽屉的真实接收者，显示第二张图片，两个落盘文件分别与各自源图 SHA-256 一致。见 `fixed-asset-library-native-import/run.log`。 |
| `agent-lane-deletion` | 用内部 `read_full_text` 作模型工具，回合收到失败结果 | 退出 0。现役 `read_script` 工具读回原文，两条旧 lane 删除后冷启无复活，新回合无旧上下文。四次调用均为回环文本夹具。见 `rerun-agent-lane-deletion/run.log`。 |
| `agent-single-shot-skill-boundary` | IPC 已返回失败，但旧 `message` 字段已迁走 | 退出 0。断言 `code` 与 `diagnostic`、零供应商请求和磁盘历史指纹不变。见 `rerun-agent-single-shot-skill-boundary/run.log`。 |
| `project-switch-background-run` | 原走查没触发 B 的首次自动保存。只比较已有字段后，重开 B 时实测差异仅为空 `workflowTemplates` 加入，素材仍为空 | 退出 0。B 的文稿真实落盘后才放行 A。回环请求只跑一次，A 有生成结果。抓屏后和抓屏在途两种切换均保住 B 的完整画布、素材和文稿。见 `final-project-switch-background-run/run.log`。 |

### 保留原脚本的红灯

- `runninghub-onboarding` 找到了「更多」中的 `model3d` 项。Playwright 真实点击被 React Flow pane 拦截。现有证据指向点击层级，模型去重后续步骤未到达。见 `baseline-runninghub-onboarding/run.log`。
- `renderer-failure-diagnostics` 的真实锁忙提示和诊断导出成功，ZIP 中的渲染日志仍有 `project-save-failed trigger=autosave`。主进程另记了 `project-save-rejected reason=workspace-busy`。原断言要求锁忙类名也出现在渲染日志同一行，本批保留该断言。见 `baseline-renderer-failure-diagnostics/run.log`。

独立脚本 `scripts/check-design-card.mjs` 在基线不存在。用 `scripts/pr-body-criteria.mjs` 的 `checkDesignCard` 和 `scripts/prior-art-lib.mjs` 的 `evaluatePlan` 校验短档五格与出处，并另外核对三段式出口和仓内路径格式。
