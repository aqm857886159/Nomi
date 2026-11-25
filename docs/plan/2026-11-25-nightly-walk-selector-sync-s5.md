# #1121 第五批夜跑走查契约同步

## 短版设计卡

### ★0 先查别人

- `tests/ux/_shell.mjs:319` · 节点新增经现役画布工具条 · 复用统一入口。
- `tests/ux/_shell.mjs:135` · 设置以页签选中态确认落位 · 沿用弹窗与 AI 策略入口。
- `tests/ux/_creationResourceTree.mjs:30` · 侧栏直接进分镜编辑器 · 从当前行及其浮层读回。
- `scripts/_test-temp.mjs:109` · 临时目录按进程归属回收 · 走查证据独立分配。

出口：`src/workbench/generationCanvas/nodes/NodeEffectChips.tsx:51` · 预设可用 Escape 回到按钮 · 验证关闭后可继续从同一入口打开。

### ★1 用户结果

夜跑值守能用现役桌面入口重放业务操作。量具为下表逐条隔离运行的脚本，基线是 8/8 夜跑报红，目标为可保留原契约的每条走查退出 0。项目、设置及存量迁移不涉及，本次条件为隔离资料与本地夹具。

### ★2 契约归属

`node scripts/door-map.mjs NodeVideoPlaybackGuard AiModelsSection NodeEffectChips StoryboardShotRow PromptEditor openStoryboardEditor --roots=src,electron,tests/ux --include-tests` 扫 6,478 文件、列 72 个入口。画布、设置、分镜和播放器各以生产入口的渲染及提交状态为准，走查负责启动、等待、退出与证据目录。空态和超时按失败定位，运行中状态由相应控件与探针读回。

### ★3 复用与根因

反复发生的是走查沿用旧入口或旧时序。最早可在契约变更验收时用真窗回放拦住，静态解析和走查登记只确认脚本结构。优先复用现役入口和共享临时目录，保留行为断言。删除断言会丢回归预警，兼容选择器会掩盖过期入口。本次用 `nightly-walk-tree-guard` 自动核对构建输入。2026-11-26 复查夜跑流水，量具为该批走查退出状态，目标为本批改动通过率 100%。

### ★4 状态

入口加载由 DOM 就绪条件等待，操作成功按业务结果断言，缺入口、未完成或部分通过均报红。取消和能力不可用沿用各走查的现役用户路径与判据。

### ★9 验收与回滚

基线和修后使用同一份 `8ac07cffb` 构建，在 macOS 隔离真窗顺序运行。基线仅重定向证据目录，设置的 Linux 红灯来自夜跑记录，本机原脚本 20/20。修后要求逐条退出 0，并核对七项指定检查及在途文件交集。负例包括少一个节点、键盘漏给下层、浮框漂移、预设选择无效、方案确认前写入、参考绑定未变化、视频仍无法解码。原判据遇到生产缺陷或已退役时保留原脚本。回滚可直接 revert 本提交。

| 走查 | 原业务判据 | 修后通过数 |
| --- | --- | --- |
| `mention-scope.walk.mjs` | 两图一目标、候选来源与过滤、两端连线、正文素材名及当前参考编号 | 10/10（16 秒） |
| `modal-input-priority.walk.mjs` | 弹层键盘优先权及关闭后工作区恢复 | 中文 20/20（49 秒），英文 20/20（50 秒） |
| `node-composer-placement.walk.mjs` | 面板收窄后仍固定宽度和相对位置，底栏可用 | 跳过。旧判据强制声音节点也有 ×N，B3 拍板改为模型声明数量后才显示，现役数量入口限图片和视频。 |
| `node-prompt-presets.walk.mjs` | 预设插入与撤销、刷新和媒介过滤、中英外观 | 9/9（17 秒） |
| `plan-gate.walk.mjs` | MCP 批量写入显式确认，确认后按三个回执 ID 读回画布 | 6/6（14 秒） |
| `storyboard-reference-slots.walk.mjs` | 具名槽、媒介路由、展开收起 | 跳过。分镜行展开/收起随 `0fc4768fb` 退役。 |
| `storyboard-table-phasec.walk.mjs` | 景别改写、四来源、插入解绑和顺序 | 跳过。景别浮层定位已实测可达，原默认无档案行仍会显示可连候选，隔离真窗点击某镜结果后读回 0 枚胶囊。写入要求现役模式声明槽，旧「不吃参考」说明也已退役。 |
| `video-playback-heal.walk.mjs` | 原 AVI 解码失败，浏览态封面，选中节点与全屏预览自愈 | 4/4（10 秒） |

跳过依据见 `docs/design/boards/2026-10-18/ComposerB3.board.json:11`、`src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:495`、`docs/design/2026-09-05-storyboard-table-v6-design-contract.md:93`、`src/workbench/creation/storyboard/StoryboardShotTable.tsx:117`、`src/workbench/settings/quietDefaults.test.ts:33`。三个脚本均与基线逐字节相同。

通过数按各脚本报告计。时长为本机通过的单次运行取整。设置和预设完成中英两轨，其他通过项用中文执行。使用现有等待基线，独立收紧基线需改本批范围外的门岗文件。
