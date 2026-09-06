# 下载量快照

数据不在 main：每日快照住在非保护数据分支 [`stats-data`](https://github.com/aqm857886159/Nomi/blob/stats-data/downloads-history.json) 的根目录 `downloads-history.json`（`.github/workflows/download-stats.yml` 每天 00:17 UTC 追加一份），main 上不留第二份。

```bash
pnpm stats                                   # 打印当前下载看板
git fetch origin stats-data && pnpm stats:html   # 生成 docs/stats/dashboard.html（本地看，已 gitignore）
```

`--snapshot` 只给流水线用，且必须显式给落点：`NOMI_STATS_HISTORY_PATH=<stats-data checkout>/downloads-history.json`，否则脚本拒绝写。口径与边界见 `scripts/stats-downloads.mjs` 文件头。
