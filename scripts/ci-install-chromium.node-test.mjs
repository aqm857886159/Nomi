// ci-install-chromium.sh 的「超时就结束整组」必须真的连孙进程一起结束：
// 2026-10-07 main 4c88addfc 那次，外层 timeout 只杀了直接子进程，留下的进程占着锁，后面每次重试都失败。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ci-install-chromium.sh')
const source = fs.readFileSync(script, 'utf8')
const fn = source.slice(source.indexOf('run_group_with_timeout() {'), source.indexOf('\n}\n', source.indexOf('run_group_with_timeout() {')) + 3)

function runBash(body) {
  return spawnSync('bash', ['-c', `set -euo pipefail\n${fn}\n${body}`], { encoding: 'utf8', timeout: 60000 })
}

test('超时会结束这一次起的整个进程组（孙进程也不留下）', () => {
  const marker = `nomi-ci-group-${process.pid}`
  const result = runBash(`set +e; run_group_with_timeout 2 bash -c 'sleep 30 & sleep 30 & wait' ${marker}; echo "rc=$?"; sleep 1; ps -eo args | grep -c "[s]leep 30" || true`)
  assert.match(result.stdout, /rc=124/)
  const leftover = Number(result.stdout.trim().split('\n').pop())
  assert.equal(leftover, 0, `超时后还剩 ${leftover} 个子孙进程：${result.stdout}${result.stderr}`)
})

test('没超时就原样返回命令的退出码', () => {
  assert.match(runBash(`set +e; run_group_with_timeout 10 bash -c 'exit 0'; echo "rc=$?"`).stdout, /rc=0/)
  assert.match(runBash(`set +e; run_group_with_timeout 10 bash -c 'exit 3'; echo "rc=$?"`).stdout, /rc=3/)
})

test('系统依赖（apt）不套外层超时，并且让 apt 自己等锁、限时、重试', () => {
  assert.match(source, /DPkg::Lock::Timeout/)
  assert.match(source, /Acquire::Retries/)
  assert.doesNotMatch(source, /timeout[^\n]*install-deps/)
  assert.doesNotMatch(source, /install --with-deps/)
})

test('重试只记普通日志、不发 ::warning:: 注解（注解卫生检查会把它当意外警告）；三次都失败才 ::error::', () => {
  assert.doesNotMatch(source, /::warning::/)
  assert.match(source, /::error::/)
})
