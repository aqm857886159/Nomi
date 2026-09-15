# PR #658 round6：先恢复失败证据，再修 waiting-effects

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 范围与顺序
1. 已在指定分支合入最新 origin/main，保留开工已有的 PF-LAST 和未跟踪历史资料。
2. 先修 benchmark / canvas-real-suite 的错误截断：完整 message、失败截图、fx canvas / 静态壳 / 节点计数落入现有 CI artifacts 路径。适用所有场景，失败状态不变。
3. 最快证据路径选择本地真实 Electron + --use-gl=swiftshader --disable-gpu --in-process-gpu（本机无 docker / xvfb-run）。打印真实 capability、Expected/Received；若无法复现，再完整 gates exit 0 后推诊断到既有 PR，读取 Linux CI artifacts。不得把本地软件渲染通过称 Linux 通过。
4. 数字到手再定位 fixture→能力观测→等待层→槽位→静态壳，并在最早有归属的边界修复；保存 ci-round6/perf-{red,green}.log。

## 复发分类与同类扫描
recurring：每个 warmup/sample、每种场景、外层 suite 均可能丢失多行断言。已查 benchmark catch/console 输出与 suite stdout/stderr/summary。产品静态壳目前在 GenerationWaitingSurface 唯一声明 data-process-static-band；prepare 与 cleanup 都按 capability 派生期望，实际失配尚未证实，不预判根因。

## 先查别人 / 依赖
现有 canvas-real-suite 已完整保存子进程原始 stdout/stderr；复用其 outputs/canvas-acceptance artifacts 目录。Playwright 已有 error.message、locator.count、screenshot，沿用现有 API，不新建框架或格式。框架版本不变：这是仓库自己的诊断截断与场景契约问题。

## 不动项、回滚、验收
不改视觉/动效行为，不跳过场景，不放宽断言，不改 reactFlow 内核，不新开 PR。回滚按本轮 scoped commit revert。验收：诊断单测（多行、长 call log、截图失败保留原错）、真实软/硬件等待场景、完整加锁 gates exit 0 后正常 hooks commit/push；PF-LAST 顶部不超过八行记录真实数字与收据。

## 首次证据
现有 CI artifact 已保存完整 stack，直接下载 run 34297944064 的 canvas-performance-evidence，无需等待一次诊断 push。原断言静态壳 Expected: 8 / Received: 6（14 次），原文见 ci-round6/perf-red.log。指定本地三参数组合 renderer:null、effectCount:0 且通过，记录为 perf-local-null.log，不冒充红证据。继续 ANGLE SwiftShader 复现；如仍未复现，诊断改动经 gates 后推既有 PR 取得现场 DOM。

诊断属于 recurring 的测试基础设施修复，同类边界与回归已在本 plan 登记。没有生产文件改动，不创建要求生产 structural artifact 的 schema-v3 合同；若后续证实生产问题，再按技能提交生产层合同。

## 已证实根因与实施边界
原 CI 静态壳 Expected 8 / Received 6；本地将真实 Electron 视口设为 1280×1000、ANGLE SwiftShader，原代码同样只保留 6 个节点 / 6 等待层 / 6 静态壳 / 0 fx。截图与逐节点 DOM 证明缺失 waiting-perf-3、waiting-perf-7（固定 x=930 的最右列）。React Flow 的 onlyRenderVisibleElements 正常裁剪了画布外节点；原始 8 层断言可在首次渲染瞬间抢先通过，后续静态断言在裁剪后只能读到 6。生产静态壳标识无缺失，能力判断无错。
修在场景准备层：设置八个节点后点击既有“适应视图”，等待八个节点几何完全进入真实 stage，且 zoom >= 0.4（保持动效资格），再执行不变的 8 等待层、能力派生 fx/静态壳、4 节点交接、离屏、卸载断言。保留八节点原尺寸/间距/采样时长/性能门限。近邻依据 tests/ux/canvas-frame.walk.mjs:128、canvas-frame-real-task.walk.mjs:85 已因同一 onlyRenderVisibleElements 边界执行相同 fit 动作。没有新的框架用法或生产文件，不需要生产根因 JSON。

## 可复现命令
`node tests/ux/canvas-performance-benchmark.e2e.mjs round6-software-green --scale M --scenario waiting-effects --runs 1 --viewport-width 1280 --viewport-height 1000 --use-angle=swiftshader --enable-unsafe-swiftshader --screenshots`
移除软件渲染参数即为同视口硬件回归。新增 viewport 参数仅为通用测量配置；默认原生窗口逻辑不变。红诊断快照 perf-local-red.json/png 证明两节点被裁掉；perf-small-viewport.log 是旧代码原始失败，原 CI 原文仍在 perf-red.log。

根因不需要等待诊断 CI 才能修复：1280px 旧断言和真实渲染已确定性复现，恢复 fit 后八节点几何进入 stage、原计数与交接均通过。首轮 gates-diagnostics.log exit 0，但本轮场景修复完成后将重跑完整 gates，不复用中途修改期间的收据。

## 最终定向结果
正式 CLI 的 1280×1000 软件组 exit 0：nodes=8 / fx=0 / static=8，交接0/4，119.7 FPS、longTasks=0；硬件 Apple M5 同视口 exit 0：nodes=8 / fx=4 / static=4，交接4/0，120 FPS、longTasks=0。两组均 warmup+sample，通过原离屏与卸载断言。对应 perf-green.log、perf-hardware-green.log 及 JSON/PNG。红/绿截图均实际查看：红缺最右列，绿八张等待卡全部进入画布。诊断单测13/13，长call log先红后绿及截图/DOM采集异常均覆盖。无模型调用，费用0。

例行雷达独立记录：radar:models exit 0，但 apimart-llm safeStorage 凭据不可读，今天该车道没查成；总体新增1（与前轮基线差异一致），未接入、未更新快照。雷达临时结果留 /tmp/pf-round6-model-radar-result.json，本任务不提交雷达。nomi-research-radar 技能在已查目录中未找到，未宣称今日论文调研完成。

## 交付 gates 收据
最终完整加锁 gates exit 0：ci-round6/gates.log、gates-receipt.json。76 contracts（73通过、0阻断、3 advisory）、153视觉、12113 Vitest通过/2跳过、运行时与构建通过。收据绑定最终六个测试基础设施源码 SHA256；本轮不改生产文件。
