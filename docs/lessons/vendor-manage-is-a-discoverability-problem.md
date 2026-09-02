# 「改不了 / 没有按钮」是可发现性问题，不是功能缺失

> 📎 教训 · 首次记录 2026-08-18 · 状态：现行（该实例已修，方法论仍适用）
> **触发场景**：收到「某个设置改不了 / 缺少某个按钮 / 翻了半天没找到」类反馈时；准备靠「把入口挪到显眼处」来解决这类反馈时。

**结论**：这类反馈**先假设功能存在**，然后**量出来**它为什么看不见。「找不到」有三种成因，处置方式完全不同——凭截图肉眼判断会系统性地误判成最容易的那一种。

**为什么会踩**：

反馈内容是「我接入的模型怎么修改？改 API URL 翻了半天没找到」「API 配置需要加一个单独的删除按钮」。实际上改地址、删整家、换 key **全都在** `src/ui/onboarding/CustomVendorManage.tsx`，自 v0.16.1（2026-07-05）起每个版本都带着。

2026-08-18 修复（PR #102，走查 `tests/ux/vendor-baseurl-discoverability.walk.mjs`）。实测根因**不是「藏得深」**，而是两层：

1. **根本没渲染在屏幕上**：`CustomVendorCard` 把模型列表排在连接块之前，24 行模型把地址行推到 `y=817`，而设置弹窗底边在 `y=706` → 被 overflow 裁掉，`document.elementFromPoint` 打到的是遮罩层。同时命中区只有 17×17。
2. **标签把人指向别处**：模型首页那一行只统计模型能力、不看网络健康，一个 401 的供应商仍显示灰色「24 个可使用」，副标题写「查看并增删模型」——主动把人往别的页面带。

**误判为什么容易发生**：被 overflow 裁掉的控件**仍在 DOM 里**，`getBoundingClientRect()` 也返回一个看起来正常的矩形。只看截图 + DOM 存在性，会得出「它在，只是不显眼」的结论（维护者第一轮就是这么判的），于是去改入口位置——治不了症。

**怎么用**：
- 查这类反馈别只看截图，跑真机走查量三个数：
  1. 控件 rect 与其**滚动祖先 / 弹窗矩形**的包含关系（`clippedByDialog`）；
  2. `document.elementFromPoint(控件中心点)` 返回的**是不是它本身**；
  3. 命中区最短边是否 ≥ 24px（WCAG 2.2 AA）。
- 三条任一不过，就**不是「挪一下入口」能解决的**——分别对应「被裁出视口」和「命中区过小」，要改布局或尺寸。
- 三条全过、功能也确实在，才轮到第三种成因：**标签/文案把人指向别处**，此时改的是措辞与状态口径（如上面那条「24 个可使用」不该忽略网络健康）。
- 写这类走查时注意：Playwright 的 `button:has-text('保存')` 会命中侧栏「文件与保存」页签——点击跑去切了 tab，脚本却一路往下走（本轮真踩过）。用 `data-model-connection-save` 这类 data 钩子锚定。

**出处**：PR #102；走查 `tests/ux/vendor-baseurl-discoverability.walk.mjs`；相关 [`walkthrough-assertions-need-a-real-signal.md`](walkthrough-assertions-need-a-real-signal.md)、[`group-says-broken-usually-means-undiscoverable.md`](group-says-broken-usually-means-undiscoverable.md)。
