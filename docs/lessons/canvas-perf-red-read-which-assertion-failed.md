# Canvas Performance 红了：先看它红在**哪一条判据**，多半根本不是预算

> 📎 教训 · 首次记录 2026-09-05 · 状态：✅ 已固化（`check:canvas-gesture-determinism` 硬零门岗 + `tests/ux/canvas-perf/gestureGeometry.mjs`）
> **触发场景**：`Canvas Performance (Linux)` 红了，而这次提交根本没碰画布；或者你正准备照
> [性能预算在 macOS 校准却在 Linux CI 执行](canvas-perf-budget-calibrated-on-macos-fails-on-linux.md) 那条去调平台预算。

## 结论

**先下载 artifact 把每条 verdict 打印出来，再决定这是哪一类问题。** 2026-09-05 那天，两个人（含一份任务书）都把
`Canvas Performance (Linux)` 的红当成「预算在 darwin 校准、Linux 太慢」的老毛病，于是准备第二次去做平台感知预算——
而平台感知预算**早就在 main 上了**（`e24dc8e84`），并且那次红**和预算一点关系都没有**：

```
run 33967545326 (main 930db4cd)  最大 frameGapP95 = 29.9ms  （darwin 顶 33 / Linux 顶 53）
                                  最大 longTaskP95  = 55ms   （顶 80 / 128）
                                  17 个 scenario 的预算判据**全绿**
pass=false 的唯一来源：warmupFailures = ["marquee selected only 8 nodes"]
```

一条命令就能看出来，省掉两轮返工：

```bash
gh run download <run-id> -n canvas-performance-evidence -D /tmp/ev
node -e 'const j=require("/tmp/ev/tests/ux/perf-results/canvas-validation-gate.json");
  console.log("pass",j.pass,"warmupFailures",JSON.stringify(j.warmupFailures));
  for(const[k,v]of Object.entries(j.summary)) if(v.verdict?.pass===false)
    console.log("FAIL",k,JSON.stringify(v.verdict.hardFailures));'
```

**`pass=false` 有两个来源**：`summary[*].verdict`（预算 + 正确性）和顶层 `warmupFailures`。
后者不在任何 scenario 的 verdict 里，只看 summary 会得出「全绿却 pass=false」的怪结论。

## 真根因：合成手势跑进了 React Flow 的自动平移带

`marquee-select` 把框选终点钉在「stage 边缘 - 10px」。而 React Flow 的
`calcAutoPan(pos, bounds, speed = 15, distance = 40)` 在指针进入 pane 边缘 **40px** 带内时，
会挂在 `requestAnimationFrame` 上**每帧平移一点视口**（`autoPanOnSelection` 默认 true，本仓没关）。

于是这一笔扫过多大区域 = **这台机器在手势期间画了多少帧**。实测（darwin，同一份代码、同一份 fixture、同一个窗口）：

| 这次跑 | 视口被自动平移了 | 选中数 |
|---|---:|---:|
| run 1 | (-95.8, -113.8) | 12 |
| run 2 | (-49.9, -62.0) | 9 |
| run 3 | (-49.9, -62.5) | 9 |

判据写的却是「必须 ≥ 12」——一个在 darwin 上调出来的常数。换到 Linux xvfb 软渲染（帧率更低、平移更少），
它就成了掷硬币：CI 上实测既出过 12 也出过 8。**所以这既不是回归，也不是预算太紧，是量具本身不可复现。**

三个容易走错的岔路，都实测排除过：

- **不是「读得太早」**：mouse.up 之后连续采样 40 次 × 50ms，计数**从头到尾平的**（9 就一直是 9），`.react-flow__node.selected` 同样是 9。不是 DOM 还没提交。
- **不是几何漂移**：两次 CI 的节点外接盒**逐位相同**（left 262.49 / right 988.22），选中数却是 12 和 8。
- **不是「挂载节点太少」**：实测 mounted=16，所以 `Math.min(12, mounted)` 这种「放宽下限」的改法是**空操作**，一行都救不了。

## 修法

① **手势别进那条带**：起点走 `findCanvasBlankPoint(page, { inset })`，终点走 `clampIntoAutoPanSafeArea`，
安全边距从库常量 derive（`REACT_FLOW_AUTO_PAN_EDGE_PX = 40` + 8 余量），不是拍脑袋。
② **期望值从扫过的那块区域 derive**，不写死节点个数：`expectedFullySelected(boxes, sweptRect)` 按
`SelectionMode.Full`（React Flow 默认，本仓没覆盖）算，并给 ±1px 的 definite/possible 区间兜住亚像素分歧。
「这一笔够不够大」改用**盖住了「够得着的节点带」的百分之多少**（≥ 0.9）——无量纲，既不含时间量，也不随窗口尺寸漂移。

> 顺带一个自己踩到又自己拆掉的坑：这条判据的第一版写的是「扫过面积 ÷ 安全区面积 ≥ 0.5」。
> 算一下才发现它随 stage 大小剧烈漂移——同一份 fixture，darwin 的 1200×790 上是 0.941，
> 换成 CI 那种更宽的 stage 就掉到 0.583。**那等于又造了一个平台相关的阈值**，正是这次要修掉的那类。
> 换成「覆盖率」之后两种 stage 上都是 1.0。**新加阈值时先拿两种窗口尺寸各算一遍，再决定它配不配当判据。**

修完实测：多次跑（多个独立进程）全部 `selected 9 / expected 9-9 / bandCoverage 1.0`，视口平移 **(0,0)**。
变异测试（去掉 Shift）报 `marquee selected 0 nodes, expected 9–9`——判据是活的，不是假绿。

## 怎么用

- **CI perf 红 → 先打印每条 verdict + `warmupFailures`**，再判断是预算、正确性、还是量具。别从「上次是预算」直接推这次。
- **看到「同一份代码在两台机器上给出不同的整数」**，先怀疑手势/动画里有按帧积分的东西（自动平移、惯性、过渡），
  别急着放宽阈值——放宽只会让下一个真回归也一起溜过去。
- **判据里出现整数字面量**（`selected < 12`、`>= N`）时问一句：这个数是从哪儿 derive 的？
  答不出来就是下一次跨平台假红。现在 `check:canvas-gesture-determinism` 会在 push 前替你问。

**出处**：`tests/ux/canvas-perf/gestureGeometry.mjs`、`scripts/check-canvas-gesture-determinism.mjs`、
`docs/fixes/2026-09-05-canvas-perf-marquee-autopan.root-cause.json`；
上游 `calcAutoPan` 默认值见 https://github.com/xyflow/xyflow/blob/main/packages/system/src/utils/general.ts ；
CI 现场 run 33967545326（main 930db4cd）与 run 33956782546（commit 5f266afd）。
