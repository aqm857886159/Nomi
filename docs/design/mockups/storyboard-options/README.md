# 分镜表生成交互方案（讨论样张）

这是三个**可浏览器打开的交互样张**，用于讨论，不代表已批准实现，也没有修改生产 UI。三案都保留 Nomi 现有的表格骨架：一行一镜、批量工具栏、行内引用、生成结果回到同一行。

| 方案 | 核心布局 | 优点 | 代价 | 判断 |
|---|---|---|---|---|
| [A 行内生成框](./A-inline-generation.html) | 首列画面格 + 中部提示词与生成设置框；参考素材在行内 | 最接近当前 `StoryboardShotTable` / 图片节点；批量时横向稳定，参数集中 | 行高会因展开结果增加 | **推荐**，先实现它 |
| [B 首列大框](./B-first-column-composer.html) | 首列生成物扩大为媒体框，右侧设置面板 | 生成物最醒目，比例切换直观 | 表格列宽被媒体占用；批量观察密度下降 | 适合大屏/重点镜头，不宜作为默认 |
| [C 锚点折叠条](./C-anchor-strip-inline-reference.html) | 顶部锚点折叠为紧凑条，展开时显示复用关系；行内引用区 | 最清楚表达“上方复用资产 → 下方镜头”的关系 | 顶部锚点状态更复杂，需要保持可发现性 | 可作为 A 的锚点层交互 |

## 共通规则

- 顶部锚点是角色、场景、道具等可重复引用资产；只有锚点有展开/收起。
- 分镜行保持表格结构。模型、模式、比例、时长、状态、操作都在行内生成设置框，不新增一排参数列。
- `@` 可引用任意已有素材；具名 slot（首帧、源视频、图片参考）按模型能力出现并限制数量。
- 编辑、ready、failed、waiting 都在同一行表达；ready 视频直接播放，图片/视频比例变化只改变媒体框的 `aspect-ratio`，不改变表格列定义。
- “自动可用”与“绑定到下一镜”分开：生成物可进入素材候选区；真正绑定显示明确来源。

打开任意 HTML 后可点击：锚点展开/收起、参考 chips、比例按钮、生成按钮、失败重试、waiting 取消。样张使用设计系统语义 token（`--nomi-*` / `--workbench-*` 的等价值），没有引入生产 token。

## 与现有页面的对账

样张按当前实现的语义和布局边界制作：`src/workbench/creation/storyboard/StoryboardShotTable.tsx` 的选择/批量工具栏与行骨架、`src/workbench/creation/storyboard/StoryboardPlanEditor.tsx` 的生成/保存为参考/设为下一镜首帧动作、`src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx` 的提示词和参数区域、`StoryboardShotRowExpand.tsx` 的参考展开区。外壳间距使用 4/8/12/16/24 的设计系统节奏，表面/文字/强调色使用 `nomi` 语义 token 的光色等值，圆角使用现有 small/medium/large 档。

局部探索只包括：生成物媒体格的 `aspect-ratio` 切换、具名参考 slot 的可见表达、锚点折叠条以及 failed/waiting 的原位反馈。没有把模型/模式/时长/比例/状态/操作抽成新的表格列，也没有改变现有画布或时间轴的信息架构。
