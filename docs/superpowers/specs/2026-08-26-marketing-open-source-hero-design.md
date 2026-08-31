# Nomi 官网真实首屏开源协作入口设计

日期：2026-08-26

## 背景与目标

当前官网真实首屏已经有深色 Hero、Nomi 标题、右侧工作流视频监视器，以及“下载 Nomi / 看 60 秒宣传片”两个行动按钮。导航虽然有 GitHub，但普通创作者和开发者都不会在首屏立刻看到“可以 Star、提 Issue、提 PR”。开源协作入口目前埋在页面后面的「面向创作者」区。

目标是在不改变现有视觉方向和视频结构的前提下，让首屏同时表达两条路径：

1. 普通用户：下载 Nomi 并开始使用。
2. 开发者：查看源码、给项目 Star、反馈问题、克隆仓库后提交 PR。

## 设计决定

采用 B 方案的真实页面版本：两个较重的主行动 + 一个轻量的开发者协作区。

```text
[下载 Nomi ↘]   [在 GitHub 查看源码 ↗]

开源协作
产品还在持续迭代。欢迎克隆仓库，按你的方式优化：
[★ 给项目 Star]  [提 Issue]  [提交 PR]
```

- 保留珊瑚色 `下载 Nomi`，继续作为第一主路径。
- 将现有“看 60 秒宣传片”降为视频入口，和 GitHub 源码按钮同级使用描边样式；视频本身仍由现有 `dialog` 打开。
- 新增描边按钮 `在 GitHub 查看源码`，目标为 `shared.repositoryUrl`。
- 新增协作区，使用比主按钮轻的文本链接/细边框链接，不引入动态 Star 数或 GitHub API。
- `给项目 Star` 目标为仓库主页；`提 Issue` 目标为 `/issues/new`，进入现有 Bug / Feature 模板选择；`提交 PR` 目标为 README 的 `#contributing` 区域，让贡献者先看到 CLA 和本地启动说明。
- 诚实说明产品仍在迭代：欢迎克隆、自己优化、提交 Issue / PR；不承诺当前版本没有问题。

## 页面结构与视觉边界

- 只改真实页面 `renderHero` 生成的左侧 `.actions` 与其紧邻内容，不改右侧 `.monitor`、视频资源、Hero 标题、导航结构和下方产品证明区。
- 新增 `.developer-invite` 区块，放在主按钮行下方，使用现有 `--coral`、`--rule`、`--mono` 和 body 字体，不新增色板、图标库或动态依赖。
- 协作链接的视觉重量低于主按钮：字号小一档、细分隔线/上边框、hover 仅变色或轻微上移，不使用三个珊瑚色实心按钮。
- 移动端保持垂直顺序：下载 → GitHub 源码 → 宣传片 → 开源协作说明与链接；链接允许换行，不横向溢出。
- 中英文页面保持同构，文案、GitHub URL 和导航层级一一对应。

## 文案

### 中文

- 主按钮：`下载 Nomi`
- GitHub 按钮：`在 GitHub 查看源码`
- 视频按钮：`看 60 秒宣传片`
- 小标题：`开源协作`
- 说明：`产品还在持续迭代。欢迎克隆仓库，按你的方式优化。`
- 链接：`★ 给项目 Star`、`提 Issue`、`提交 PR`

### English

- Primary: `Download Nomi`
- GitHub: `View source on GitHub`
- Film: `Watch the 60s film`
- Kicker: `OPEN SOURCE / CONTRIBUTE`
- Description: `Nomi is still evolving. Clone the repo, improve it your way, and help shape what comes next.`
- Links: `★ Star the repo`, `Open an issue`, `Submit a PR`

## 验收标准

1. `pnpm run build:site` 生成 `marketing/index.html` 与 `marketing/en/index.html`，且 `pnpm run build:site -- --check` 通过。
2. `tests/ux/marketing-home.static.mjs` 覆盖中英文首屏存在下载、GitHub 源码、Star、Issue、PR 文案与对应地址。
3. 真实浏览器打开本地生成的 `marketing/index.html`，首屏截图能看到现有 Hero 视频监视器和新增开发者入口；不接受只验证 HTML 字符串的完成声明。
4. 桌面和窄屏宽度下，主按钮与协作链接不溢出、不遮挡标题或视频；宣传片 dialog 仍能打开。
5. 不引入 GitHub API、动态 Star 数、额外依赖或第二套独立营销页。

## 不在范围内

- 不改品牌标题、产品证明区、团队服务区、社群区和页脚。
- 不做 GitHub 登录、站内 Star 代理、Issue/PR 表单内嵌或贡献者统计。
- 不把 GitHub 协作入口扩展成新的独立页面。

