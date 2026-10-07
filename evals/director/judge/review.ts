import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { DirectorCard } from '../cardSchema'
import { judgeOutputSchema, pairwiseSchema, parseJsonObject, type JudgeOutput, type Preregistration } from './schema'
import { pairwisePrompt, reviewPrompt } from './prompts'

export const DIRECTOR_REVIEW_TIMEOUT_MS = Number(process.env.NOMI_DIRECTOR_REVIEW_TIMEOUT_MS ?? 6 * 60 * 1000)

function runCodex(args: string[], prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'codex',
      [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '-s',
        'read-only',
        '-m',
        'gpt-6-astra',
        '-c',
        'model_reasoning_effort=high',
        '-c',
        'service_tier="priority"',
        ...args,
        '-',
      ],
      { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.stdin.write(prompt)
    child.stdin.end()
    child.once('error', reject)
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`codex review timed out after ${DIRECTOR_REVIEW_TIMEOUT_MS}ms`))
    }, DIRECTOR_REVIEW_TIMEOUT_MS)
    child.once('close', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve(stdout) : reject(new Error(`codex exited ${code}: ${stderr.trim()}`))
    })
  })
}

type RunCodex = typeof runCodex
export type ReviewOptions = { runCodex?: RunCodex; timeoutMs?: number }
export type PairwiseOptions = {
  displayOrder?: 'random' | 'forward' | 'reverse'
  randomBit?: () => boolean
  runCodex?: RunCodex
  timeoutMs?: number
}
export type PairwiseWinner = 'left' | 'right' | 'tie' | 'unclear'

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`codex review timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const isTimeout = (error: unknown): boolean => error instanceof Error && /timed out after/.test(error.message)

/** Translate a model's display-position answer into the source scheme at that position. */
export function mapPairwiseWinner(
  winner: PairwiseWinner,
  displaySources: ['left' | 'right', 'left' | 'right'],
  leftScheme: string,
  rightScheme: string,
): string {
  if (winner !== 'left' && winner !== 'right') return winner
  const source = displaySources[winner === 'left' ? 0 : 1]
  return source === 'left' ? leftScheme : rightScheme
}

export async function reviewOnce(
  card: DirectorCard,
  preregistration: Preregistration,
  images: string[],
  cwd = os.tmpdir(),
  options: ReviewOptions = {},
): Promise<{
  value?: JudgeOutput
  error?: string
  fast: boolean
  raw?: string
  retries: number
  blocked: boolean
  durationMs: number
}> {
  const temp = await fs.mkdtemp(path.join(cwd, 'nomi-director-review-'))
  const randomized = [...images].sort(() => crypto.randomInt(-1, 2))
  const copied: string[] = []
  const runner = options.runCodex ?? runCodex
  let retries = 0
  let schemaError = ''
  const startedAt = Date.now()
  try {
    for (const image of randomized) {
      const target = path.join(temp, `${crypto.randomBytes(8).toString('hex')}.png`)
      await fs.copyFile(image, target)
      copied.push(target)
    }
    const args = copied.flatMap((file) => ['-i', file])
    const prompt = reviewPrompt(
      card,
      preregistration,
      copied.map((file) => path.basename(file)),
    )
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await withTimeout(
        runner(
          args,
          attempt === 0
            ? prompt
            : `${prompt}\nSchema error from the previous response: ${schemaError}. Return only a corrected JSON object matching the schema.`,
          temp,
        ),
        options.timeoutMs ?? DIRECTOR_REVIEW_TIMEOUT_MS,
      )
      try {
        const value = judgeOutputSchema.parse({ review: (parseJsonObject(raw) as { review: unknown }).review })
        return {
          value,
          fast: !raw.includes('service tier `priority` is not advertised'),
          raw,
          retries,
          blocked: false,
          durationMs: Date.now() - startedAt,
        }
      } catch (error) {
        schemaError = error instanceof Error ? error.message : String(error)
        if (attempt === 0) {
          retries = 1
          continue
        }
        return {
          error: error instanceof Error ? error.message : String(error),
          fast: false,
          raw,
          retries,
          blocked: true,
          durationMs: Date.now() - startedAt,
        }
      }
    }
    return {
      error: 'judge response schema validation exhausted',
      fast: false,
      retries,
      blocked: true,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      fast: false,
      retries,
      blocked: isTimeout(error),
      durationMs: Date.now() - startedAt,
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}

export async function pairwiseOnce(
  card: DirectorCard,
  preregistration: Preregistration,
  left: string,
  right: string,
  leftScheme = 'left',
  rightScheme = 'right',
  cwd = os.tmpdir(),
  options: PairwiseOptions = {},
): Promise<{
  value?: ReturnType<typeof pairwiseSchema.parse>
  displayWinner?: PairwiseWinner
  error?: string
  fast: boolean
  retries: number
  blocked: boolean
  durationMs: number
}> {
  const temp = await fs.mkdtemp(path.join(cwd, 'nomi-director-pair-'))
  const runner = options.runCodex ?? runCodex
  let retries = 0
  let schemaError = ''
  const startedAt = Date.now()
  try {
    const reversed =
      options.displayOrder === 'reverse' ||
      (options.displayOrder !== 'forward' && (options.randomBit ?? (() => crypto.randomInt(0, 2) === 1))())
    const sides = reversed
      ? [
          { source: right, origin: 'right' as const },
          { source: left, origin: 'left' as const },
        ]
      : [
          { source: left, origin: 'left' as const },
          { source: right, origin: 'right' as const },
        ]
    const targets = await Promise.all(
      sides.map(async ({ source }) => {
        const target = path.join(temp, `${crypto.randomBytes(8).toString('hex')}.png`)
        await fs.copyFile(source, target)
        return target
      }),
    )
    const args = ['-i', targets[0], '-i', targets[1]]
    const prompt = pairwisePrompt(card, preregistration)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await withTimeout(
        runner(
          args,
          attempt === 0
            ? prompt
            : `${prompt}\nSchema error from the previous response: ${schemaError}. Return only a corrected JSON object.`,
          temp,
        ),
        options.timeoutMs ?? DIRECTOR_REVIEW_TIMEOUT_MS,
      )
      try {
        const value = pairwiseSchema.parse(parseJsonObject(raw))
        return {
          value: {
            ...value,
            winner: mapPairwiseWinner(
              value.winner,
              [sides[0].origin, sides[1].origin],
              leftScheme,
              rightScheme,
            ) as typeof value.winner,
          },
          displayWinner: value.winner,
          fast: !raw.includes('service tier `priority` is not advertised'),
          retries,
          blocked: false,
          durationMs: Date.now() - startedAt,
        }
      } catch (error) {
        schemaError = error instanceof Error ? error.message : String(error)
        if (attempt === 0) {
          retries = 1
          continue
        }
        return {
          error: error instanceof Error ? error.message : String(error),
          fast: false,
          retries,
          blocked: true,
          durationMs: Date.now() - startedAt,
        }
      }
    }
    return {
      error: 'pairwise response schema validation exhausted',
      fast: false,
      retries,
      blocked: true,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      fast: false,
      retries,
      blocked: isTimeout(error),
      durationMs: Date.now() - startedAt,
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}
