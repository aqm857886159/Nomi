# C76 · 创作区三栏工作区面板外框

> 已于 2026-09-10 03:05 批准（PR #689）；03:10/04:32 裁决仅外框，发送按钮保持原位。生产实施证据见 [对账](creation-columns-evidence/implementation/README.md)。
> 基线：`5c507a5cc3ee74f5fa25706165cb94cd3d2e8165`，包含 #646 pi lane 切换。
> 方案：[2026-09-10-creation-columns](../plan/2026-09-10-creation-columns.md)。

三栏同时服务于同一个创作任务，却像三个不同页面拼在一起。建议让三栏拥有相同的边框、圆角、顶部基线和标题带；正文仍按列表、文稿、对话各自的阅读密度排版。需要权衡的是：左栏由贴边导航变成独立面板，损失少量留白空间，换取一眼能看懂的三栏秩序。

## 现状与证据

已读完整 `WorkbenchShell.tsx`、`CreationWorkspace.tsx`、`DocumentListSidebar.tsx`、`WorkbenchEditor.tsx`、`AssistantPane.tsx`，并检查 Agent 的 resident shell / V4 panel 结构。参照昨晚真实走查 `~/Desktop/Nomi-merge-gate/tests/ux/shots/g1-c0-gate-r2/attempt-1UrYyt/C0-2ae7265a-00.png`（只读），在当前 worktree 的隔离 Electron 新建测试项目复核。

![生产改前：隔离资料库新建文稿](creation-columns-evidence/production-before.png)

下图使用完整现役 WorkbenchShell、真实资源树、Tiptap 编辑器和 resident Agent，仅以固定文稿 / lane projection 替代个人资料，便于与样张保持相同内容。**不是复制三栏 JSX 的模拟界面**。没有真实模型调用。

![现役完整外壳](creation-columns-evidence/columns-current.png)

1440×900 内容视口、浅色模式，computed style 原始数据：[现状 JSON](creation-columns-evidence/columns-current.json)。padding 按「上 右 下 左」理解；二值为垂直/水平。

| 实测项目 | 左：创作内容列表 | 中：文稿编辑器 | 右：Agent 面板 |
|---|---|---|---|
| 可见外框 owner | DocumentListSidebar | WorkbenchEditor | AgentPanelV4Panel |
| radius | 0px | 10px (`rounded-workbench`) | 10px (`rounded-nomi`) |
| border | 仅右边 1px `nomi-line-soft` | 四边 1px `workbench-border` | 四边 1px `nomi-line` |
| shadow | none | `shadow-workbench-md`：0 2px 4px 黑4% + 0 8px 24px 黑6% | none |
| header 高度 | 48px | 44px | 40px |
| header padding | 0 12px | 0 12px | 0 12px |
| 外框 padding | 0 | 0（宿主另加16px） | 0（AssistantPane另加16px） |
| body padding | nav：8px | Tiptap：24px 32px 80px；另有680px阅读宽限制 | flow：10px 12px |
| 背景 | `nomi-paper` | `workbench-surface-solid` → `nomi-paper` | `nomi-paper` |
| 顶部 y / 高度 | 56 / 844px | 72 / 812px | 72 / 812px |

**对原描述的修正**：最新基线的中、右圆角和面板底色已相同；三栏头部水平 padding 也相同。当前仍不一致的是左栏边界/位置、三种头高、中栏独有阴影，以及内容区密度。内容区内距不强行拉成同一值：文稿需要阅读宽度，对话与列表需要密度。

## 推荐样张

![浅色样张](creation-columns-evidence/columns-specimen.png)

![暗色样张](creation-columns-evidence/columns-specimen-dark.png)

| 共同外框规格 | 现有 token / 类名 | 目标值 |
|---|---|---|
| 圆角 | `rounded-nomi` / `--nomi-radius` | 10px |
| 边框 | `border border-nomi-line` / `--nomi-line` | 单层四边1px |
| 背景 | `bg-nomi-paper` / `--nomi-paper` | 浅纸白 / 暗暖灰，随主题翻转 |
| 阴影 | `shadow-none` | 无；三栏不以悬浮卡片分高低 |
| header | `h-12 px-3 py-0` | 48px高、水平12px |
| header分隔 | `border-b border-nomi-line-soft` | 1px轻分隔线 |
| 外框内容内距 | 不在外框叠 padding | 0；内部列表/正文/对话各自负责 |
| 三栏共同留白 | `p-4 gap-4` | 四周及栏间16px |
| 溢出 | `overflow-clip` + 内部现役滚动区域 | 外框不被 scrollIntoView 推走 |

[浅色样张实测](creation-columns-evidence/columns-specimen.json) / [暗色实测](creation-columns-evidence/columns-specimen-dark.json)：三栏 y 均为72，高度均为812，header均为48，圆角均为10，栏间16。所有控制保持原所在功能簇，没有新增标题按钮、重复收起入口或菜单。遵循设计系统 §1.5「先分组」；不涉及控件层级变更。

## 可实现源码与打开方式

- 交互样张：`pnpm run dev:renderer` 后打开 `/design-lab.html?screen=creation-columns&state=columns-specimen`。暗色选 `columns-specimen-dark`，原状选 `columns-current`。
- 源码：`src/devlab/designLab/creationColumns/CreationColumnsStage.tsx`。同一个 `frames` selector 将共同规格应用到三件真实组件；`headers` 管共同标题带；`layout` 只调整这一张样张的宿主边界。没有生产 import。
- [HTML+CSS 源码样张](creation-columns-evidence/specimen.html)：从该 React 实例导出的实际 DOM，链接仓库的 `public/tailwind.generated.css` 和 `src/theme/nomi-tokens.css`，使用真实 token 名。运行 `node scripts/build-tailwind.mjs` 后可在仓库 HTTP 服务打开；它是静态外观存档，交互看实验室。不另造一份配色或图片占位。
- [复现采集脚本](creation-columns-evidence/capture.mjs)：隔离 Electron（三类用户目录隔离），生产新建项目截图 → 三个实验室状态 → computed style → HTML。需 `pnpm install`、`pnpm run build:electron` 和 Vite `:5273`。
- 新屏已登记 `labScreens.ts` / `labStates.mjs`。新增的三张候选基线尚未获用户批准，`calibration.json` 明确登记待拍板；不覆盖、不放宽任何现役基线或断言。

## 用户拍板后的加新删旧清单（本轮不执行）

| 组件 / 边界 | 加入共享规格 | 同次删除的旧 owner |
|---|---|---|
| 创作三栏宿主 | 在共同布局层统一16px留白与间隙 | CreationWorkspace 中栏 `p-4` 与创作态 AssistantPane 重复 `p-4`；同步移除该态宽度预算里重复32px gutter |
| DocumentListSidebar | 由共享 WorkspacePanelFrame 承担外框；保留列表行/树/菜单行为 | 自定义 `border-r border-nomi-line-soft` 的贴边外框 |
| WorkbenchEditor | 共享 frame + header 48px；保留 Tiptap/选区/正文内距 | 自定义 `rounded-workbench border-workbench-border shadow-workbench-md`，44px grid行和toolbar高度 |
| AgentPanelV4Panel | 外框与header由共享 frame/header 类规格负责 | 局部 `rounded-nomi border-nomi-line` 的重复外框声明和40px header高度 |
| AssistantPane | 继续只负责 dock / 拖宽；创作布局统管其留白 | 创作态局部可见边界与重复宽度换算，不增加第二层卡片 |

共享 frame 应只拥有圆角、边框、底色、标题带；不要包新的状态 store 或复制 Agent/composer。明确全局消费者边界：AgentPanelV4Panel 与 AssistantPane 还供生成/分镜/预览使用，生产实施前必须检查其它面的原样契约；本任务授权只覆盖创作面，不能顺带把其它工作区改成三栏。

## 验收范围与关联

此次证明的是「共同外框可由现役组件组成、明暗外观成立」，不是 Agent 业务接线或完整创作链路验收。固定文稿和 lane 数据为合成夹具，模型选择为空是隔离环境事实。

关联 [PR #678](https://github.com/aqm857886159/Nomi/pull/678)：该提案涵盖四面助手外框、拖宽、状态与品牌。本轮基线已前进到 #646 后，只讨论完整创作三栏；其它未拍板内容不继承。来源与取舍见方案「先查别人」。
