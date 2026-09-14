#!/usr/bin/env node
/**
 * Git pre-push 适配器：**只查收据，不跑模型**（2026-09-15）。
 *
 * 评审本身搬去了交工前的 `pnpm run review:branch`（scripts/ponytail-review-branch.mjs，
 * 抬头有为什么）。钩子留下的职责只剩一条、也只能是这一条：证明「要推出去的这棵树
 * 真的被评审过」。判据是**树**不是提交——rebase、改提交信息、换作者都不改内容，
 * 不该逼人重审；内容一变树就变，收据当场失效。
 *
 * 没有收据、树对不上、收据的 mergeBase 不在这条历史里 → fail-closed 拦住 push。
 */

import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import { receiptPath, repoRootFromGit, runGit, verifyPushReceipt } from './ponytail-review-branch.mjs'

// 四十个 0（删除 ref 的占位 SHA）本身就落在这个字符集里，不需要第二条正则。
const SHA = /^[0-9a-f]{40}$/i

function validateSha(value, label) {
  if (!SHA.test(value)) throw new Error(`Invalid ${label} SHA: ${value}`)
  return value.toLowerCase()
}

/** Parse the four-column protocol Git sends to a pre-push hook.
 *  没有体积上限：这里不再喂模型，而 readFileSync(0) 早就把 stdin 全读进内存了，
 *  在它之后再判字节数护不住任何东西。 */
export function parsePushInput(input) {
  const ranges = []
  for (const rawLine of String(input || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const fields = line.split(/\s+/)
    if (fields.length !== 4) throw new Error(`Invalid pre-push line: ${line}`)
    const [localRef, localShaRaw, remoteRef, remoteShaRaw] = fields
    ranges.push({
      localRef,
      localSha: validateSha(localShaRaw, 'local'),
      remoteRef,
      remoteSha: validateSha(remoteShaRaw, 'remote'),
    })
  }
  return ranges
}

function main() {
  try {
    if (process.argv[2] === '--help' || process.argv[2] === '-h') {
      console.log('Usage: node scripts/ponytail-review-hook.mjs  (reads Git\'s pre-push ref updates on stdin)')
      return 0
    }
    const repoRoot = repoRootFromGit()
    const ranges = parsePushInput(fs.readFileSync(0, 'utf8'))
    const result = verifyPushReceipt({ repoRoot, ranges })
    if (result.ok) {
      console.error(`[ponytail-receipt] ok${result.receipt ? ` (${result.receipt.status}, ${result.receipt.reviewedAt})` : `: ${result.reason}`}`)
      return 0
    }
    console.error(`[ponytail-receipt] BLOCKED: ${result.reason}`)
    console.error(`交工前先跑一次整分支评审：pnpm run review:branch（收据写到 ${receiptPath(repoRoot)}）。`)
    console.error('runner 真的不可用时：pnpm run review:branch -- --defer（留痕，check:ponytail-review 会红到补审）。')
    return 1
  } catch (error) {
    console.error(`[ponytail-receipt] BLOCKED: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) process.exitCode = main()
