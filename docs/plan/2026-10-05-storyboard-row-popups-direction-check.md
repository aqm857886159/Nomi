# 方向检查：分镜行上的弹出层（LAW12-sb-row-more）

> 触发：提交 hook 的 RW 统计——`src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx` 近 14 天第 4 个 fix。
> 交给协调会话拍板；本页不改产品方向。

### 0. 一句话根因

分镜行上的弹出层各自决定「怎么开、怎么关、浮在哪」：行首「⋯」菜单是原地 `absolute`、只有再点一次才收，而同一行底栏的 ⋯ 弹层早已收编到 `AnchoredPopover`。同一种东西两套开合，点外面关不关取决于点的是哪一个。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 本次 LAW12-sb-row-more（点外面不关、盖住缩略图） | 行菜单没有点外关闭，原地 absolute | 弹出层开合各写各的 |
| dad3db47e 参考图提示文案与混排 | 文案出口两份 | 文案（不同类） |
| 51d09c7ff 首帧镜误判缺参考 | 判据两份 | 判据（不同类） |
| bc45ad4b3 React 19 类型 | 依赖升级 | 不同类 |

同文件 4 个 fix 里只有本次属于「弹出层开合」这一类；其余三个各是别的概念。

### 2. 为什么这一类会一直出现

`AnchoredPopover` 的注释里有一张「全仓浮层定位现有四套」的清单，第 ④ 类（原地 absolute / 手写定位）还有 8 个文件，行菜单不在名单上却同属这一类。每收编一个就少一处「点外面不关 / 被 overflow 裁掉 / 盖住别的东西」。

- ⑫ 点了=以为的：直接命中（`tests/ux/full-walk/playbooks/pb12-storyboard-click-expectations.walk.mjs`）。
- ⑩ / ⑪：不适用。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 行菜单里的「换画幅…」子列表（行内展开）在矮窗口里被行的 overflow 截掉一截 | pb12 加最小窗变体，点开换画幅量 `measureOverlayReach` |
| 另外 8 个原地定位的弹出层里，至少一个点外面不关 | 把它们登记进 `STORYBOARD_CLICK_TARGETS` 一类的可点目标表，逐个走 |

### 4. 靶子独立性检查

⑫ 的判据只看真实 DOM：点前菜单在、点后菜单不在、点的那一下落到了画面格上（第 1 镜被选中）。与实现无关；修前修后同一条剧本一红一绿。

### 5. P0：这些是我们独有的吗

不是。弹出层定位与点外关闭是通用能力，仓里已有现成的两套（Radix `WorkbenchMenu`、`AnchoredPopover`）。本次接入现成的 `AnchoredPopover`，不自写监听。

### 6. 对比与推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案（本提交） | 行菜单交给 `AnchoredPopover`：贴「⋯」开、点外面 / Esc 关、mousedown 不吞事件 | 一处包装，菜单内容与样子不变 | 菜单仍会盖住它正下方那一块（任何弹出层都会）；用户点外面那一下照样生效 | **推荐，现在做** |
| 接入现成方案（Radix） | 改成 `WorkbenchMenu`（菜单一族的规范外壳，带方向键） | 「换画幅…」行内展开要改成子菜单或单选组，样子会变 | 是界面改动，要先出样张 | 等分镜表那张 Design 画布拍板时一起定 |
| 补 | 在原地 absolute 上手写一个 document 监听 | 一个 effect | 第 N 份点外关闭实现 | 不推荐 |
| 删 | 去掉行菜单，动作挪进别处 | 大 | 产品改动 | 不推荐 |

### 7. 用户要权衡的核心

现在只修「点外面不关」、样子不动；还是借分镜表这次 Design 画布，把行菜单换成全站统一的菜单外壳（带方向键、子菜单），代价是行菜单的样子会变。

## 特征测试清单

- `tests/ux/full-walk/playbooks/pb12-storyboard-click-expectations.walk.mjs` 的 `sb-row-more`（变异：换回旧 `StoryboardShotRow.tsx` 重新构建，这一格红；修复后绿）。
- `tests/ux/core-a-storyboard-undo.e2e.mjs`（行菜单「删除」后立即撤销，菜单定位跟着改为按 `data-storyboard-row-menu` 找）。
