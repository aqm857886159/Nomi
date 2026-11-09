#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function followMainCheckout(root) {
  if (!root) return ''
  const git = (...args) =>
    spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
  const read = (...args) => {
    const result = git(...args)
    return result.status === 0 ? result.stdout.trim() : ''
  }
  const top = read('rev-parse', '--show-toplevel')
  if (!top) return ''
  if (realpathSync(root) !== realpathSync(top)) return ''
  const gitDir = read('rev-parse', '--path-format=absolute', '--git-dir')
  const commonDir = read('rev-parse', '--path-format=absolute', '--git-common-dir')
  if (!gitDir || gitDir !== commonDir) return ''

  const warn = (reason, files = '') => {
    const behind = read('rev-list', '--count', 'HEAD..origin/main') || '未知'
    return `⚠️ [main-follow] ${reason}；落后 ${behind} 个提交（本地 origin/main）；阻挡文件：${files.trim().replace(/\r?\n/g, ' · ') || '无'}。`
  }
  const blocked = () => {
    const branch = read('symbolic-ref', '--short', 'HEAD') || 'detached HEAD'
    const status = git('status', '--porcelain=v1', '--untracked-files=no')
    if (status.status !== 0) return warn('无法检查工作区，未更新')
    if (branch !== 'main') return warn(`当前分支 ${branch}，未更新`, status.stdout)
    if (status.stdout.trim()) return warn('工作区不干净，未更新', status.stdout)
    return ''
  }
  const initialBlock = blocked()
  if (initialBlock) return initialBlock
  const fetched = git('fetch', 'origin', 'main')
  if (fetched.status !== 0) return warn('fetch 失败（离线或 Git 锁占用），未更新；稍后重开会话可重试')
  // Another session can change the branch or working files while fetch runs.
  const afterFetchBlock = blocked()
  if (afterFetchBlock) return afterFetchBlock
  const before = read('rev-parse', 'HEAD')
  const merged = git('merge', '--ff-only', 'origin/main')
  if (merged.status !== 0) return warn('无法快进或 Git 锁占用，未更新；请核对本地分支差异和锁', merged.stderr || '')
  const after = read('rev-parse', 'HEAD')
  if (after === before) return ''
  const dependenciesChanged = read('diff', '--name-only', before, after, '--', 'pnpm-lock.yaml')
  return `[main-follow] 主仓已跟上 ${after.slice(0, 9)}。${dependenciesChanged ? '主仓依赖要装：请在主仓排锁运行 pnpm install --frozen-lockfile。' : ''}`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const message = followMainCheckout(process.env.CLAUDE_PROJECT_DIR)
    if (message) console.log(message)
  } catch {
    console.log('⚠️ [main-follow] 主仓状态检查失败，已跳过；请检查仓库路径后重开会话。')
  }
}
