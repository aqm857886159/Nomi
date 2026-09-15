# 合成夹具永远走不到真实素材那条路

> 📎 教训 · 首次记录 2026-09-14 · 状态：✅ 已固化（门岗 `check:real-media-fixture` + 规则 R13「四件真实」第④件接管）
> **触发场景**：画布 / 性能 / 导入 / 导出测试全绿，用户第一次拿自己的素材试就卡住或导不进来；或你要为「媒体多了会不会卡」写一条新测试。

**结论**：画布 / 性能 / 导入 / 导出 / 时间轴类测试用 ffmpeg `testsrc2`、SVG、1px 占位图这种合成夹具，等于**没测**——它同时压掉了两件事：素材的真实解码成本（真实 4K 10-bit HEVC vs 1280×720 crf-35 小文件差三个数量级），和素材**怎么进来**的那条链路（夹具直接写 `project.json` 快照，导入一步都没走）。要用登记过的真实素材，缺素材时**红，不是跳**。

## 症状

2026-09-14，第一次拿用户真实素材（`9月12日(1).mov`，3840×2160 10-bit HEVC，1,380,939,031 字节；以及从它抽帧的 4K PNG）跑 Nomi：

1. **AI 拿着视频和图片，导入不了画布。**
2. **S 规模（24 图 + 24 视频节点）20 秒内进不了画布**——三个动作全部卡在「打开项目」阶段，还没到任何交互。

第 2 条比 FPS 掉帧严重得多：帧率差是「用起来不爽」，打开不了是「根本进不去」。而**画布性能基准跑了几十轮、留了 80 多份 `tests/ux/perf-results/*.json`，一次都没红过这个**。

## 为什么之前测不到

看 `tests/ux/fixtures/canvas-performance-fixture.mjs`：

| 维度 | 夹具 | 用户的真实素材 |
|---|---|---|
| 图片 | `testsrc2` 合成的 960×540 / 1920×1080 PNG，再叠一层 `drawbox` 半透明纯色（`:22-25, 53-62`）| 4K PNG ≥ 8 MB，真实照片 |
| 视频 | 1280×720、**2 秒**、`-crf 35 -preset ultrafast -pix_fmt yuv420p` 的 H.264（`:26-29, 66-78`）| 3840×2160、**10-bit HEVC**、1.38 GB |
| 规模 | `S = { imageCount: 24, videoCount: 24, edgeCount: 96, clipCount: 12 }`（`:16`）| 用户撞到的**正是 24 图 + 24 视频** |

三个结构性盲区，任何一个单独就足以让这条路永远绿：

1. **素材成本被压到接近零。** `testsrc2` + `drawbox` 出来的是平坦色块，PNG 压缩率极高、解码几乎免费；视频是 2 秒 crf-35 的 720p，首帧解码同样免费。**10-bit HEVC 还是另一条解码路径**——很多机器没有硬解，退软解，成本不是「大一点」是「不同数量级」。`cold-open` 场景确实有 20 秒预算（`canvas-performance-benchmark.e2e.mjs:582`，`20_000 * openScale`），但 48 个廉价小文件从来没有逼近过它，所以这条预算**存在而从未生效**。
2. **导入链路一步都没走。** 夹具不导入，它**直接写 `project.json` 快照**（`:266-268`），把 `result.url` 填成 `nomi-local://` 地址。用户那句「导入不了画布」落在一条自动化测试从未执行过的路上——不是断言写错了，是**那条路上没有断言**。
3. **媒体几何是硬写的。** 夹具里 `imageWidth: 960` / `videoWidth: 1280` 是字面量（`:132-137`），不是从文件探出来的。于是「探测真实素材尺寸」这条链路同样零覆盖，而且夹具自己就违反了「随输入 derive 不 hardcode」。

**这是本仓反复栽的那一族**：`vacuous-probe-passes-forever.md`（探针测不到它命名的那件事，断言就永远绿）。区别只在于这次空的不是断言而是**输入**——输入假了，再严谨的断言也只是在证明「假输入下没事」。

顺带澄清一个容易走偏的方向：这次**不是** `canvas-perf-budget-calibrated-on-macos-fails-on-linux.md` 那一类（预算校准平台不对）。预算没问题，素材有问题。**别去动预算**——那是 P2 的症状修法。

## 怎么用

- **写任何画布 / 性能 / 导入 / 导出 / 时间轴测试之前**，先问两句：① 这份素材的解码成本和用户手里那份差几个数量级？② 素材是**导进来**的，还是我直接写进快照的？两句里有一句答不好，这条测试证明不了它声称的事。
- **素材从 `NOMI_REAL_MEDIA_DIR` 取**，登记在 `tests/ux/real-media-fixtures.json`（规格 + 来源，**素材本身不进 git**），取用走 `tests/ux/fixtures/realMedia.mjs` 的 `requireRealMediaAssets()`。缺素材时它**抛错并逐条列出缺什么**——不许 skip、不许退回合成素材兜底（skip 就是 R17「登记即放绿」的同一种自欺）。
- **准备 4K PNG**：从同一条真实视频抽帧，别用合成图。
  ```bash
  export NOMI_REAL_MEDIA_DIR="$HOME/Desktop/视频/9月12日(1)"
  ffmpeg -ss 00:00:05 -i "$NOMI_REAL_MEDIA_DIR/9月12日(1).mov" -frames:v 1 \
    -vf scale=3840:2160 "$TMPDIR/frame-4k.png"
  ```
- **判「性能没问题」之前先看有没有 cold-open 那一档的真素材数字**。只有拖拽 / 缩放 / 框选的 FPS 数字，说明只测了「已经进得去之后」。
- **修「导入不了」本身要另走 P2**：跑 `node scripts/door-map.mjs <导入 mutator>` 数清素材进画布一共有几扇门（拖拽、文件选择、素材库、Agent 工具、MCP 导入），门表进根因合同的 `doors`。本条教训只保证**下次这条路上有测试**，不代替根因。

## 出处

- 夹具：`tests/ux/fixtures/canvas-performance-fixture.mjs:16`（S 档 24+24）、`:22-29`（合成素材清单）、`:132-137`（硬写几何）、`:266-268`（直写项目快照）
- 预算：`tests/ux/canvas-performance-benchmark.e2e.mjs:568,582`（`openScale`、20s 打开超时）、`:96`（`cold-open` 场景）
- 真实素材：`/Users/aoqimin/Desktop/视频/9月12日(1)/9月12日(1).mov`，1,380,939,031 字节（2026-09-14 实测 `ls -la`）
- 规则与门岗（2026-09-14 落地）：`docs/engineering-rules.md` 的 R13「四件真实」；`scripts/check-real-media-fixture.mjs` + 登记表 `tests/ux/real-media-fixtures.json` + 债 `docs/engineering/real-media-debt.json` + 合成夹具棘轮 `scripts/real-media-fixture-baseline.json`
- 关联教训：`vacuous-probe-passes-forever.md`、`lab-fixtures-must-mirror-real-callsites.md`、`canvas-perf-budget-calibrated-on-macos-fails-on-linux.md`（这次**不是**它）
