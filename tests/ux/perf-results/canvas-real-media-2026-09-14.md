# 真实素材画布收据 · 2026-09-14（macOS arm64，交付提交 1e93d5b0f，dirty=false）

分支 `fix/canvas-media-preview-lod-20260914`（取代 PR #776）。素材：用户的 3840×2160 / 10-bit HEVC / 30fps `.mov` 流拷贝前 10 秒（22.5MB，`-c copy`，编码未变）+ 从同一段视频抽的 4K PNG（22.1MB）。
命令（`NOMI_CANVAS_PERF_REAL_ASSET_DIR=<目录> NOMI_CANVAS_PERF_CANVAS_ONLY=1`）：

```
node tests/ux/canvas-performance-benchmark.e2e.mjs real-media-s  --scale S  --scenario node-drag-image,node-drag-video --runs 1 --warmup 0
node tests/ux/canvas-performance-benchmark.e2e.mjs real-media-xl --scale XL --scenario node-drag-image,node-drag-video --runs 1 --warmup 0
```

| 规模 / 场景 | fps | 帧间隔 P95（预算 53） | 最大帧间隔（预算 160） | 长任务 | 交互中 `<video>` 上限 | 加载中视频/图片上限 |
|---|---:|---:|---:|---:|---:|---:|
| S / node-drag-image | 118.6 | 9.8 ms | 41.8 ms | 0 | 0 | 0 / 0 |
| S / node-drag-video | 109.4 | 13.8 ms | 135.3 ms | 114 ms | 0 | 1 / 3 |
| XL / node-drag-image | 117.6 | 9.8 ms | 45.4 ms | 0 | 0 | 0 / 1 |
| XL / node-drag-video | 57.4 | 19.9 ms | 103.6 ms | 87 ms | 0 | 1 / 2 |

预算全过；`pass:false` 唯一原因是每个场景各一条 `[missing-intervention-card] spend-confirm spend-surface-unavailable productionRunApi.pendingSpend rejected` console error（main 侧 #764 引入，benchmark 隔离实例没装能力核；不属于本分支，未绕）。
`maxActiveVideos = 0`：交互前画布上没有任何 `<video>`，视频节点只挂 poster。文件：`canvas-real-media-s.json`、`canvas-real-media-xl.json`。
