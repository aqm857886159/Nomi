#!/usr/bin/env bash
# CI 装 Playwright Chromium 的唯一入口（四个 workflow 共用，别在 yml 里再写第二份）。
# 为什么要包一层：2026-10-07 main 上 #1074 合入提交两次卡在 `playwright install` 38 分钟，
# 把整个 E2E job 拖到 40 分钟上限被取消、一条走查都没跑；同一时段别的 PR 装同一个浏览器只要 25–80 秒。
# 下载挂住是 runner / CDN 的偶发，不是代码问题——每次限时、挂住就重试，三次都不行再红，
# 让「下载挂住」几分钟内就以真实原因失败，而不是冒充成走查超时。
set -euo pipefail

attempts=3
per_attempt_seconds=240

for i in $(seq 1 "$attempts"); do
  if timeout "$per_attempt_seconds" pnpm exec playwright install --with-deps chromium; then
    exit 0
  fi
  echo "::warning::playwright install chromium 第 ${i}/${attempts} 次失败或超过 ${per_attempt_seconds} 秒，重试"
done

echo "::error::playwright install chromium 连续 ${attempts} 次失败（每次限 ${per_attempt_seconds} 秒）"
exit 1
