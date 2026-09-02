import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { classifyValidationPolicy, VALIDATION_POLICY_OUTPUTS } from './validation-policy.mjs'

function changedEntries({ cwd = process.cwd(), base, head } = {}) {
  if (!base || !head) return []
  const output = execFileSync('git', ['diff', '--name-status', base, head], { cwd, encoding: 'utf8' })
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status, ...pathParts] = line.split('\t')
      return { status, path: pathParts.at(-1) || '' }
    })
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
      `quality-gate policy: unit=${result.unit}, desktop=${result.desktop}, walkthroughs=${result.walkthroughs}, journeys=${result.journeys}, canvas=${result.canvas}, performance=${result.performance}, package=${result.package} (${result.reason}; ${result.files.length} changed files)`,
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
