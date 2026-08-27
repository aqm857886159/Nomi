# 官网首屏 GitHub 协作入口设计

## 背景

官网最新基线为 `origin/main` 提交 `0f363e69`（Nomi v0.21.0）。当前首屏已有“下载 Nomi”和“观看 60 秒工作流”两个动作，标题上方还有 `OPEN-SOURCE · LOCAL-FIRST · AI VIDEO WORKBENCH` 英文浮条。用户希望在不重做官网的前提下，让访客能直接进入 GitHub，理解项目仍在迭代，并愿意通过 Issue 或 PR 帮助改进。

## 目标

- 在中文与英文首屏增加一个与下载按钮并列的 GitHub 协作入口。
- 明确邀请用户提交 Issue 或 PR，但保持诚实、克制，不把“仍在迭代”写成不必要的风险提示。
- 删除中文和英文首屏顶部重复性的英文浮条；其他分区中有结构语义的英文小标签保留。
- 删除首屏“观看 60 秒工作流”入口及只服务于该入口的交互链；不删除仍被其他页面或 SEO 使用的媒体资源。
- 保持远端最新官网的布局、字体、间距体系、导航、产品图、SEO 元数据和页面信息架构不变。

## 设计

### 首屏动作层级

首屏保留下载按钮作为深色主按钮，新增 GitHub 协作按钮作为空心次按钮。新按钮直接复用远端现有 `.button` 的高度、内边距、字号、字重、圆角、动效和可访问性状态，宽度随中英文文案自然撑开；仅使用现有 coral 色区分边框与文字，不新增组件体系。

- 中文：`去 GitHub 参与改进 ↗`
- 英文：`Help improve it on GitHub ↗`
- 目标地址：`https://github.com/aqm857886159/Nomi`
- 外链属性：`target="_blank" rel="noreferrer"`

按钮下保留一行轻量协作说明；在窄屏自然换行，不增加横幅或新的首屏区块。

- 中文：`项目还在快速迭代。遇到问题欢迎提 Issue，想一起改进可以提交 PR。`
- 英文：`Nomi is still evolving. Found a problem? Open an issue. Want to help shape it? Send a pull request.`

### 浮条与工作流入口

仅移除首屏 hero 内的通用英文浮条：中文和英文均不再显示 `OPEN-SOURCE · LOCAL-FIRST · AI VIDEO WORKBENCH`。页面其他 section 的 eyebrow 继续保留，因为它们承担分区识别功能。

移除首屏 `观看 60 秒工作流` 链接。若 `launch-film` dialog、触发绑定和相关脚本仅由该首屏入口使用，则一并移除死链；视频文件本身保留，除非源码核对确认没有其他页面引用。

### SEO、可访问性与降级

- 不改中文/英文页面的 `title`、`description`、canonical、OG/Twitter 元数据、语言切换和 sitemap。
- 不把 Issue/PR 邀请写入结构化数据，避免把协作说明误当成产品功能实体。
- GitHub CTA 使用真实可见文本，支持键盘焦点和无 JavaScript 外链跳转。
- 保留下载、GitHub 和社区路径在无 JS、媒体加载失败和移动端下的可用性。

## 实现边界

### 预计修改

- `scripts/marketing/content.mjs`：中英文 hero 文案与动作数据。
- `scripts/marketing/template.mjs`：若模板需要新增 CTA 或协作说明的结构绑定。
- `scripts/marketing/styles.mjs`：仅补充 CTA 次按钮的既有 token/class 组合和协作说明间距。
- `scripts/marketing/client.mjs`：仅在确认无其他调用者后清理 60 秒工作流对话框触发链。
- `marketing/index.html`、`marketing/en/index.html`：由官网构建脚本生成，不手工维护生成差异。
- `tests/ux/marketing-home.static.mjs`、`tests/ux/marketing-home.visual.mjs`：补充首屏 CTA、旧浮条和 60 秒入口的契约与视觉验证。

### 明确不做

- 不重做 hero、不更换字体、不调整主标题和产品图。
- 不新增 banner、卡片、弹窗或新的导航层级。
- 不删除其他分区的英文 eyebrow，不删除仍被使用的媒体资源。
- 不改 README、下载流程、许可证、社区区块或远端 GitHub 仓库内容。

## 验收标准

1. 中英文页面首屏都显示同一按钮规格的下载按钮和 GitHub 协作按钮，下载为主按钮，GitHub 为空心 coral 次按钮；按钮宽度随文案自然变化。
2. 中英文页面首屏都没有通用英文浮条和“观看 60 秒工作流”入口；其他分区 eyebrow 数量和语义不被误删。
3. GitHub CTA 地址、外链属性、可见文本和键盘焦点正确。
4. 1440px、390px、320px 视口无水平溢出；协作说明在移动端自然换行，主标题和产品图不发生结构性位移。
5. 无 JavaScript、媒体阻断、减少动效场景仍能完成下载和 GitHub 跳转。
6. 通过官网静态检查、视觉检查，并人工查看中英文桌面/移动截图，与 `origin/main` 基线逐项对账。

## 风险与回滚

- 风险：模板中的 `launch-film` 逻辑可能被其他入口复用。实现前先做完整引用搜索，只清理确认无调用者的代码；若存在其他入口，仅移除首屏触发。
- 风险：按钮文案在 320px 下换行。通过现有 flex-wrap、按钮最大宽度和短文本约束处理，不改整体 hero 栅格。
- 回滚：只需回滚本次官网专项分支提交；不触碰当前工作区的未提交修改。
