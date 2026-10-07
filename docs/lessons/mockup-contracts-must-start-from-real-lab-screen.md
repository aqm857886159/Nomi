# 样张合同必须从真实实验室屏产生

> 教训 · 首次记录 2026-10-04 · 状态：✅ 已固化为 P5 / R8 与 `check:mockup-contracts`

## 症状与根因

3D-BOX 导演视图的拍板样张是手写独立 HTML：它复制 token 色值，却没有生产组件、真实宿主数据或真实调用点。实现照图复刻后，小窗内容和位置、标题、多出的按钮、镜头条结构连续五轮漂移。类根因是 L1 只要求「出样张 + 拍板」，R8 只写「组件复用」，`check:mockup-contracts` 只检查契约存在和是否被走查引用；规则没有把拍板物绑定到真实渲染路径，所以照字面执行也不会触发。

## 同类四次证据

- [`docs/design/2026-09-10-node-composer-bar-v1.md`](../design/2026-09-10-node-composer-bar-v1.md)：实验室格子和真机截的是同一份生产代码，证据强度因此成立。
- [`docs/plan/2026-09-06-canvas-frame-tool.md`](../plan/2026-09-06-canvas-frame-tool.md)：取景台要求真实组件渲染，不画样张。
- [`docs/plan/2026-09-09-storyboard-warning-aggregate-eta/README.md`](../plan/2026-09-09-storyboard-warning-aggregate-eta/README.md)：把手画样张绕开真实组件与调用点列为根因。
- [`docs/qa/2026-09-04-pr454-storyboard-agent-audit.md`](../qa/2026-09-04-pr454-storyboard-agent-audit.md)：手画样张返工七轮被否，仍未进入真实组件。

## 为什么以前没有升级

这四次只留下了局部文档和实验室的正例，没有把「实验室屏必须由生产组件 + 真实宿主数据渲染」写入常驻 P5、触发规则 R8、每轮 hook 或门岗判据；存量 HTML 合同也没有只减不增的边界。于是下一次任务仍可按旧文字合法地产出手写 HTML，门岗还会绿。现在门岗要求新验收合同登记 `labScreen`、宿主直接 import 生产组件、状态不在 devlab 另画 JSX，并为每个 `data-mockup-region` 提供完整对账行；存量 HTML 只留在基线，后续只能减少。

## 机器证据

违规夹具（未登记 `labScreen` 的新验收合同）使门岗输出「缺少 labScreen」并退出非零；删除夹具后现有 5 份合同继续通过，样张缺契约基线为 62 张。回归测试在 `scripts/check-mockup-contracts.node-test.mjs`。
