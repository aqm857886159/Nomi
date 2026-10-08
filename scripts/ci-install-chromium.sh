#!/usr/bin/env bash
# CI 装 Playwright Chromium 的唯一入口（四个 workflow 共用，别在 yml 里再写第二份）。
# 为什么要包一层：2026-10-07 main 上 #1074 合入提交两次卡在 `playwright install` 38 分钟，
# 把整个 E2E job 拖到 40 分钟上限被取消、一条走查都没跑；同一时段别的 PR 装同一个浏览器只要 25–80 秒。
#
# 分两步，因为两步挂住的方式不一样（2026-10-07 main 4c88addfc 的 Unit 红就是没分开）：
#   1. 系统依赖（apt，sudo 起的 root 进程）：只跑一次，靠 apt 自己的超时 / 重试 / 等锁兜住。
#      不在外面套 timeout——外层 timeout 杀得掉 pnpm、杀不掉 sudo 起的 apt-get，
#      留下的 apt-get 占着 dpkg 锁，后面每次重试都报「Could not get lock」。
#   2. 浏览器下载（普通用户进程）：每次限时，超时就把这一次起的整个进程组结束掉再重试，
#      不留半截下载占着 Playwright 的目录锁。
set -euo pipefail

attempts=3
per_attempt_seconds=240

if command -v apt-get >/dev/null 2>&1; then
  echo 'Acquire::Retries "3"; Acquire::http::Timeout "30"; Acquire::https::Timeout "30"; DPkg::Lock::Timeout "300";' \
    | sudo tee /etc/apt/apt.conf.d/99nomi-ci >/dev/null
  pnpm exec playwright install-deps chromium
fi

# 在自己的进程组里跑一条命令，超时就结束整组（先 TERM，5 秒后 KILL）。返回 124 表示超时。
run_group_with_timeout() {
  local limit=$1
  shift
  set -m
  "$@" &
  local pid=$!
  set +m
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$limit" ]; then
      kill -TERM -- "-$pid" 2>/dev/null || true
      sleep 5
      kill -KILL -- "-$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

for i in $(seq 1 "$attempts"); do
  if run_group_with_timeout "$per_attempt_seconds" pnpm exec playwright install chromium; then
    exit 0
  fi
  # 普通日志，不发 ::warning:: 注解：重试后装上了就是成功，注解会被 CI 注解卫生检查当成「意外警告」把 Quality Gate 打红
  # （2026-10-07 main 5e72e5bbd 就这样红过一次）。三次都失败才发 ::error::。
  echo "[ci-install-chromium] 第 ${i}/${attempts} 次失败或超过 ${per_attempt_seconds} 秒，重试"
done

echo "::error::playwright install chromium 连续 ${attempts} 次失败（每次限 ${per_attempt_seconds} 秒）"
exit 1
