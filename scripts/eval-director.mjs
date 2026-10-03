// Director goal-alignment fixture and report contract.
// This is a deterministic evidence adapter: it does not start Electron, call a
// model, or replace the Agent Runtime/Lane/Skill/Tool contracts.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DIRECTOR_CASES_PATH = path.join(repoRoot, 'evals', 'director', 'prompt-cases.v1.json')
export const DIRECTOR_RUBRIC_PATH = path.join(repoRoot, 'evals', 'director', 'rubric.v1.json')

const REQUIRED_KEYS = ['scene', 'object', 'action', 'camera', 'timing', 'aspect']
const REQUIRED_TAGS = ['one-shot', 'three-shot', 'push', 'pull', 'orbit', 'follow', 'target-switch']

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export function loadDirectorCases(filePath = DIRECTOR_CASES_PATH) {
  return readJson(filePath)
}

export function loadDirectorRubric(filePath = DIRECTOR_RUBRIC_PATH) {
  return readJson(filePath)
}

function requireString(errors, value, label, minLength = 1) {
  if (typeof value !== 'string' || value.trim().length < minLength)
    errors.push(`${label} must be a string with at least ${minLength} characters`)
}

function requireStringArray(errors, value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== 'string' || !entry.trim())
  ) {
    errors.push(`${label} must be a non-empty string array`)
  }
}

/**
 * Lightweight contract validation kept dependency-free so fixtures can be
 * checked in CI before the full app dependencies are installed.
 */
export function validateDirectorCases(dataset) {
  const errors = []
  if (dataset?.schemaVersion !== 'director-goal-eval/v1') errors.push('schemaVersion must be director-goal-eval/v1')
  if (dataset?.status !== 'targets-only') errors.push('status must be targets-only')
  if (!Array.isArray(dataset?.cases)) return [...errors, 'cases must be an array']
  if (dataset.cases.length < 20 || dataset.cases.length > 32) errors.push('cases must contain 20-32 evaluation targets')

  const ids = new Set()
  const tags = new Set()
  dataset.cases.forEach((item, index) => {
    const prefix = `cases[${index}]`
    requireString(errors, item?.id, `${prefix}.id`)
    if (ids.has(item?.id)) errors.push(`${prefix}.id duplicates ${item.id}`)
    ids.add(item?.id)
    if (item?.evaluationTarget !== true) errors.push(`${prefix}.evaluationTarget must be true`)
    requireString(errors, item?.prompt, `${prefix}.prompt`, 20)
    if (!item?.expectedDirectorCard || typeof item.expectedDirectorCard !== 'object')
      errors.push(`${prefix}.expectedDirectorCard is required`)
    else {
      for (const key of ['title', 'scene', 'objectFocus', 'action', 'camera', 'aspectRatio'])
        requireString(errors, item.expectedDirectorCard[key], `${prefix}.expectedDirectorCard.${key}`)
      if (
        !Number.isInteger(item.expectedDirectorCard.shotCount) ||
        item.expectedDirectorCard.shotCount < 1 ||
        item.expectedDirectorCard.shotCount > 3
      ) {
        errors.push(`${prefix}.expectedDirectorCard.shotCount must be 1-3`)
      }
    }
    if (!['indoor', 'outdoor', 'product', 'person'].includes(item?.category))
      errors.push(`${prefix}.category is invalid`)
    if (!Array.isArray(item?.tags) || item.tags.length < 2) errors.push(`${prefix}.tags must contain at least two tags`)
    else item.tags.forEach((tag) => tags.add(tag))
    if (!item?.required || typeof item.required !== 'object') errors.push(`${prefix}.required is required`)
    else {
      for (const key of REQUIRED_KEYS) {
        if (!(key in item.required)) errors.push(`${prefix}.required.${key} is required`)
      }
      for (const key of ['scene', 'object', 'action', 'camera'])
        requireStringArray(errors, item.required[key], `${prefix}.required.${key}`)
      if (
        !Number.isInteger(item.required.timing?.shotCount) ||
        !Number.isFinite(item.required.timing?.minDurationSeconds)
      )
        errors.push(`${prefix}.required.timing must include shotCount and minDurationSeconds`)
      requireString(errors, item.required.aspect?.ratio, `${prefix}.required.aspect.ratio`)
    }
    requireString(errors, item?.expectedFailureBehavior, `${prefix}.expectedFailureBehavior`, 20)
  })
  for (const tag of REQUIRED_TAGS) if (!tags.has(tag)) errors.push(`matrix is missing tag ${tag}`)
  return errors
}

function clampScore(value) {
  if (value === null || value === undefined || value === 'unobserved') return null
  return Math.max(0, Math.min(4, Number(value)))
}

function boolScore(value) {
  return value === true ? 4 : value === false ? 0 : null
}

function findJudgment(judgments, id) {
  return judgments.find((judgment) => judgment.id === id)?.score ?? null
}

function markdownTableValue(value) {
  return String(value ?? '—')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
}

function buildMarkdown(report) {
  const observed = report.observed
  const checks = report.automatedChecks.length
    ? report.automatedChecks
        .map(
          (check) =>
            `| ${markdownTableValue(check.id)} | ${check.pass ? 'PASS' : 'FAIL'} | ${markdownTableValue(check.evidence)} |`,
        )
        .join('\n')
    : '| — | — | no automated checks recorded |'
  const judgments = report.humanJudgments.length
    ? report.humanJudgments
        .map(
          (judgment) =>
            `| ${markdownTableValue(judgment.id)} | ${judgment.score}/4 | ${markdownTableValue(judgment.note)} |`,
        )
        .join('\n')
    : '| — | — | no human judgment recorded |'
  const dimensions = Object.entries(report.score.dimensions)
    .map(([id, score]) => `| ${id} | ${score === null ? 'unobserved' : `${score}/4`} |`)
    .join('\n')
  return [
    '# Director goal-alignment report',
    '',
    `- Run ID: ${report.runId}`,
    `- Commit: ${report.commit}`,
    `- Case: ${report.caseId}`,
    '',
    '## Prompt and expected Director card',
    '',
    `**Prompt:** ${report.prompt}`,
    '',
    `**Expected card:** ${report.expectedDirectorCard.title} · ${report.expectedDirectorCard.shotCount} shot(s) · ${report.expectedDirectorCard.camera} · ${report.expectedDirectorCard.aspectRatio}`,
    '',
    '## Observed result',
    '',
    `- Generation success: ${observed.generationSuccess ? 'PASS' : 'FAIL'}`,
    `- Whitebox scene: ${observed.whiteboxScene ? 'PASS' : 'FAIL'}`,
    `- Object motion: ${observed.objectMotion ? 'PASS' : 'FAIL'}`,
    `- Camera motion: ${observed.cameraMotion ? 'PASS' : 'FAIL'}`,
    `- Playable preview: ${observed.playablePreview ? 'PASS' : 'FAIL'}`,
    `- Local edit precision: ${observed.localEditPrecision}`,
    `- Time to first preview: ${observed.timeToFirstPreviewMs === null ? 'unobserved' : `${observed.timeToFirstPreviewMs} ms`}`,
    '',
    '## Automated checks',
    '',
    '| Check | Result | Evidence |',
    '|---|---|---|',
    checks,
    '',
    '## Human judgments',
    '',
    '| Judgment | Score | Note |',
    '|---|---:|---|',
    judgments,
    '',
    '## Evidence',
    '',
    `- Screenshots: ${report.evidence.screenshots.length ? report.evidence.screenshots.join(', ') : '—'}`,
    `- Videos: ${report.evidence.videos.length ? report.evidence.videos.join(', ') : '—'}`,
    '',
    '## Score',
    '',
    '| Dimension | Score |',
    '|---|---:|',
    dimensions,
    `| **Overall** | **${report.score.overall}** |`,
    `| Automated checks | ${report.score.automatedPass ? 'PASS' : 'FAIL'} |`,
    `| Human judgments recorded | ${report.score.humanJudgmentCount} |`,
    '',
    `Failure reason: ${report.failureReason || '—'}`,
    '',
  ].join('\n')
}

export function buildDirectorReport(input, { dataset = loadDirectorCases(), rubric = loadDirectorRubric() } = {}) {
  const errors = validateDirectorCases(dataset)
  if (errors.length) throw new Error(`invalid Director dataset: ${errors.join('; ')}`)
  const item = dataset.cases.find((candidate) => candidate.id === input.caseId)
  if (!item) throw new Error(`unknown Director case: ${input.caseId}`)
  if (input.prompt !== item.prompt) throw new Error(`prompt does not match case ${input.caseId}`)
  if (!input.commit || !/^[0-9a-f]{7,40}$/i.test(input.commit))
    throw new Error('commit must be a 7-40 character git SHA')
  const observed = {
    generationSuccess: Boolean(input.observed?.generationSuccess),
    whiteboxScene: Boolean(input.observed?.whiteboxScene),
    objectMotion: Boolean(input.observed?.objectMotion),
    cameraMotion: Boolean(input.observed?.cameraMotion),
    playablePreview: Boolean(input.observed?.playablePreview),
    localEditPrecision: input.observed?.localEditPrecision || 'unobserved',
    timeToFirstPreviewMs: input.observed?.timeToFirstPreviewMs ?? null,
  }
  const automatedChecks = Array.isArray(input.automatedChecks)
    ? input.automatedChecks.map((check) => ({
        id: String(check.id),
        pass: Boolean(check.pass),
        evidence: String(check.evidence || ''),
        ...(check.reason ? { reason: String(check.reason) } : {}),
      }))
    : []
  const humanJudgments = Array.isArray(input.humanJudgments)
    ? input.humanJudgments.map((judgment) => ({
        id: String(judgment.id),
        score: clampScore(judgment.score) ?? 0,
        note: String(judgment.note || ''),
      }))
    : []
  const scores = {
    generationSuccess: boolScore(observed.generationSuccess),
    promptCorrespondence: clampScore(findJudgment(humanJudgments, 'prompt-correspondence')),
    playableCompleteness: [
      observed.whiteboxScene,
      observed.objectMotion,
      observed.cameraMotion,
      observed.playablePreview,
    ].every(Boolean)
      ? 4
      : 0,
    localizedEditPrecision:
      observed.localEditPrecision === 'pass'
        ? 4
        : observed.localEditPrecision === 'partial'
          ? 2
          : observed.localEditPrecision === 'fail'
            ? 0
            : null,
    userEffortTimeToFirstPreview:
      observed.timeToFirstPreviewMs === null
        ? null
        : observed.timeToFirstPreviewMs <= 60_000
          ? 4
          : observed.timeToFirstPreviewMs <= 120_000
            ? 2
            : 0,
    recoverabilityRollback: (() => {
      const check = automatedChecks.find((entry) => entry.id === 'recoverability-rollback')
      return check ? boolScore(check.pass) : null
    })(),
  }
  const dimensionWeights = new Map(rubric.dimensions.map((dimension) => [dimension.id, dimension.weight]))
  const present = Object.entries(scores).filter(([, score]) => score !== null)
  const totalWeight = present.reduce((sum, [id]) => sum + (dimensionWeights.get(id) || 0), 0)
  const overall = totalWeight
    ? +(
        present.reduce((sum, [id, score]) => sum + (score / 4) * (dimensionWeights.get(id) || 0), 0) / totalWeight
      ).toFixed(3)
    : 0
  const report = {
    reportVersion: 'director-goal-report/v1',
    contractId: 'director-goal-alignment',
    datasetVersion: dataset.schemaVersion,
    runId: String(input.runId),
    commit: String(input.commit),
    caseId: item.id,
    prompt: item.prompt,
    expectedDirectorCard: item.expectedDirectorCard,
    observed,
    automatedChecks,
    humanJudgments,
    evidence: {
      screenshots: Array.isArray(input.evidence?.screenshots) ? [...input.evidence.screenshots].map(String) : [],
      videos: Array.isArray(input.evidence?.videos) ? [...input.evidence.videos].map(String) : [],
    },
    score: {
      dimensions: scores,
      overall,
      automatedPass: automatedChecks.length > 0 && automatedChecks.every((check) => check.pass),
      humanJudgmentCount: humanJudgments.length,
      measurementStatus: 'observed-run',
    },
    failureReason: input.failureReason == null ? null : String(input.failureReason),
  }
  report.markdown = buildMarkdown(report)
  return report
}

function printUsage() {
  console.error('Usage: node scripts/eval-director.mjs validate | report --input <json> [--output <json>]')
}

function argumentValue(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

export function main(args = process.argv.slice(2)) {
  const command = args[0]
  if (command === 'validate') {
    const errors = validateDirectorCases(loadDirectorCases())
    if (errors.length) {
      console.error(errors.join('\n'))
      return 1
    }
    console.log(`Director goal dataset valid: ${loadDirectorCases().cases.length} targets (targets-only)`)
    return 0
  }
  if (command === 'report') {
    const inputPath = argumentValue(args, '--input')
    if (!inputPath) {
      printUsage()
      return 2
    }
    const report = buildDirectorReport(readJson(path.resolve(inputPath)))
    const outputPath = argumentValue(args, '--output')
    if (outputPath) {
      fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
      fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`)
      console.log(`Director report written: ${outputPath}`)
    } else {
      console.log(JSON.stringify(report, null, 2))
    }
    return 0
  }
  printUsage()
  return 2
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = main()
