#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function compareWorkflowRef({ ref, resolvedSha, workflowSha, triggerRef = '', triggerEvent = '' }) {
  const expected = String(resolvedSha || '').trim()
  const actual = String(workflowSha || '').trim()
  if (!expected || !actual) {
    throw new Error(
      `RC ref guard cannot compare commits: trigger=${triggerEvent || 'unknown'} ` +
        `trigger_ref=${triggerRef || 'unknown'} input_ref=${ref || 'unknown'} ` +
        `resolved_sha=${expected || 'missing'} github_sha=${actual || 'missing'}`,
    )
  }
  if (expected !== actual) {
    throw new Error(
      `RC ref guard rejected a mismatched workflow commit: trigger=${triggerEvent || 'unknown'} ` +
        `trigger_ref=${triggerRef || 'unknown'} input_ref=${ref || 'unknown'} ` +
        `resolved_sha=${expected} github_sha=${actual}. ` +
        'Dispatch the workflow from the branch or commit named by inputs.ref so packaging validates the intended source.',
    )
  }
  return { ref, sha: expected }
}

export function resolveRefSha(ref, { cwd = repoRoot, git = execFileSync } = {}) {
  const value = String(ref || '').trim()
  if (!value) throw new Error('RC ref guard requires a non-empty inputs.ref')
  try {
    return git('git', ['rev-parse', '--verify', `${value}^{commit}`], { cwd, encoding: 'utf8' }).trim()
  } catch (error) {
    throw new Error(`RC ref guard cannot resolve inputs.ref=${value}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function main({ env = process.env, cwd = repoRoot, git = execFileSync, log = console.log } = {}) {
  const ref = env.WORKFLOW_REF || env.INPUT_REF || env.GITHUB_REF_NAME
  const resolvedSha = resolveRefSha(ref, { cwd, git })
  const result = compareWorkflowRef({
    ref,
    resolvedSha,
    workflowSha: env.WORKFLOW_SHA || env.GITHUB_SHA,
    triggerRef: env.TRIGGER_REF || env.GITHUB_REF,
    triggerEvent: env.TRIGGER_EVENT || env.GITHUB_EVENT_NAME,
  })
  log(`RC ref guard passed: ref=${result.ref} sha=${result.sha}`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`RC ref guard failed closed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
