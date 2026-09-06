import fs from 'node:fs'
import { classifyValidationPolicy, VALIDATION_POLICY_OUTPUTS } from './validation-policy.mjs'
import { gitNameStatus } from './lib/gitPaths.mjs'

function changedEntries({ cwd = process.cwd(), base, head } = {}) {
  if (!base || !head) return []
  // 路径一律经 gitNameStatus 读（`-z`）：默认 quotePath 会把非 ASCII 路径转义并加引号，
  // 分类器于是把 `docs/中文.md` 当成不认识的路径，整条 PR 的验证档被选错。
  return gitNameStatus(['diff', '--name-status', base, head], { cwd })
}

export function resolveProfileFromEnvironment(env = process.env, cwd = process.cwd()) {
  const eventName = env.GITHUB_EVENT_NAME || 'pull_request'
  const requestedMode = env.NOMI_VALIDATION_MODE || ''
  const entries = changedEntries({ cwd, base: env.NOMI_BASE_SHA, head: env.NOMI_HEAD_SHA || 'HEAD' })
  return classifyValidationPolicy(entries, { eventName, requestedMode })
}

export function writeGithubOutput(result, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return
  const values = VALIDATION_POLICY_OUTPUTS.map((name) => {
    const outputName = name.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`)
    return `${outputName}=${result[name]}`
  })
  fs.appendFileSync(
    outputPath,
    `${[...values, `reason=${result.reason}`, `changed_count=${result.files.length}`].join('\n')}\n`,
  )
}

if (process.argv[1] && process.argv[1].endsWith('select-quality-gate-profile.mjs')) {
  try {
    const result = resolveProfileFromEnvironment()
    writeGithubOutput(result)
    console.log(
      `quality-gate policy: unit=${result.unit}, desktop=${result.desktop}, journeys=${result.journeys}, canvas=${result.canvas}, performance=${result.performance}, package=${result.package} (${result.reason}; ${result.files.length} changed files)`,
    )
  } catch (error) {
    const result = classifyValidationPolicy([], { requestedMode: 'full' })
    result.reason = 'classifier_error_fail_closed'
    writeGithubOutput(result)
    console.error(error instanceof Error ? error.message : String(error))
    console.error(`quality-gate policy: all surfaces (${result.reason})`)
    process.exit(0)
  }
}
