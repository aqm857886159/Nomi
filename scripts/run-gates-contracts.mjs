#!/usr/bin/env node
/**
 * `gates:contracts` 的执行体：**全部跑完再汇总**，并按声明把个别门岗降为 advisory。
 *
 * ── 为什么不再用 `&&` 长链（2026-09-05，依据 2026-08-22→09-05 全量 CI 失败审计）──
 * 原来 51 个 check 用 `&&` 串成一行：第一个红就停。于是「一次改动违反 3 个门岗」=
 * 3 轮完整 CI + 3 个补丁 commit。审计里的真实化石：
 *   · `codex/project-agent-host-phase1-20260827` 在文档门上连红 15 轮
 *     （docs-index → ledger → ledger → docs-index → docs-index → doc-status ×4 → ledger ×6）
 *   · `fix/walkthrough-catalog-readonly-20260902`：一篇 md，红 4 轮
 * 早退省下的墙钟（Contracts 跑到红的中位数 0.8 分钟）远小于它逼出来的重推轮次。
 * 这里改成「跑完全部、一次报全」——**fail-closed 不变，只是不早退**。
 *
 * ── advisory 是什么（不是「关掉门岗」）──
 * `--advisory=` 里点名的门岗**照样跑、照样打印**，但它的失败不阻断本次验证，而是
 * 变成一条 GitHub warning 注解 + 汇总里的一行。前提是**这类失败有别的主体负责补齐**：
 * 目前只有三个文档/生成物门（docs-index / doc-status / ledger），补齐方是
 * `.github/workflows/docs-autosync.yml`（main 合入后自动重生成并回写）。
 * 它们的共同点是「红了也拦不住任何生产 bug，只拦记账」，且**补齐动作是确定性的、机器能做**。
 * 判据没有放松：直接跑 `pnpm run check:docs-index` 仍然 exit 1，autosync 就是靠这个语义验收的。
 *
 * 谁能进 advisory 名单：失败可由机器确定性补齐，且补齐主体已经存在并会真的跑。
 * 「这个门岗老是红、很烦」不是理由——那是要么修根因、要么删门岗，不是降级。
 *
 * 用法：node scripts/run-gates-contracts.mjs [--advisory=a,b] <check:x> <check:y> ...
 * 门岗清单仍然逐个写在 package.json 的 `gates:contracts` 里（顺序即执行顺序），
 * 这样 `check:gates-chain` 依旧能从 package.json 一眼看全，不用去解析别的数据文件。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 汇总里为每个失败门岗回放的输出行数——够定位，不至于把日志再刷一遍。 */
export const FAILURE_TAIL_LINES = 15

export class GateConfigError extends Error {}

/**
 * 解析命令行。**任何不认识的东西都报错**：这条链是验证的总入口，
 * 「看不懂就跳过」会把一个本该跑的门岗变成静默不跑（正是 check:gates-chain 立项要防的事）。
 */
export function parseGateArgs(argv) {
  const gates = []
  const advisory = new Set()
  for (const arg of argv) {
    if (arg.startsWith('--advisory=')) {
      for (const name of arg.slice('--advisory='.length).split(',')) {
        const trimmed = name.trim()
        if (trimmed) advisory.add(trimmed)
      }
      continue
    }
    if (arg.startsWith('-')) throw new GateConfigError(`未知参数：${arg}`)
    gates.push(arg)
  }
  if (gates.length === 0) throw new GateConfigError('没有给出任何门岗名——链是空的，等于什么都没验')
  const duplicates = gates.filter((name, index) => gates.indexOf(name) !== index)
  if (duplicates.length > 0) throw new GateConfigError(`门岗重复：${[...new Set(duplicates)].join('、')}`)
  const orphanAdvisory = [...advisory].filter((name) => !gates.includes(name))
  if (orphanAdvisory.length > 0) {
    throw new GateConfigError(
      `--advisory 点名了不在链里的门岗：${orphanAdvisory.join('、')}（名单过期了，删掉或把它接回链里）`,
    )
  }
  return { gates, advisory }
}

/** 门岗名必须是 package.json 里真实存在的脚本，否则 pnpm 只会说 "Command not found" 而没人看。 */
export function assertGatesExist(gates, scripts) {
  const missing = gates.filter((name) => !Object.hasOwn(scripts, name))
  if (missing.length > 0) {
    throw new GateConfigError(`package.json 里没有这些脚本：${missing.join('、')}`)
  }
}

function tail(output) {
  const lines = output.split('\n').filter((line) => line.trim() !== '')
  return lines.slice(-FAILURE_TAIL_LINES)
}

/** GitHub Actions workflow command：注解正文必须单行，换行要转义。 */
function annotation(level, title, message) {
  return `::${level} title=${title}::${message.replaceAll('\n', '%0A')}`
}

/**
 * 跑完整条链并汇总。`runGate` 注入，便于测试用假门岗做阳性对照。
 * 返回 { failures, advisoryFailures, exitCode }。
 */
export async function runGateSuite({ gates, advisory, runGate, write = (text) => process.stdout.write(text), env = process.env }) {
  const inActions = env.GITHUB_ACTIONS === 'true'
  const failures = []
  const advisoryFailures = []
  const started = Date.now()

  for (const [index, name] of gates.entries()) {
    const label = `[${index + 1}/${gates.length}] ${name}${advisory.has(name) ? '（advisory）' : ''}`
    write(`\n▶ ${label}\n`)
    const gateStarted = Date.now()
    const { code, output } = await runGate(name)
    const seconds = ((Date.now() - gateStarted) / 1000).toFixed(1)
    if (code === 0) {
      write(`✅ ${name} (${seconds}s)\n`)
      continue
    }
    const record = { name, code, tail: tail(output), seconds }
    if (advisory.has(name)) {
      advisoryFailures.push(record)
      write(`⚠️ ${name} 未通过（advisory，退出码 ${code}，${seconds}s）——不阻断，见文末汇总\n`)
    } else {
      failures.push(record)
      write(`❌ ${name} 失败（退出码 ${code}，${seconds}s）——继续跑完剩下的门岗\n`)
    }
  }

  const totalSeconds = ((Date.now() - started) / 1000).toFixed(1)
  write(`\n${'─'.repeat(60)}\n`)
  write(
    `gates:contracts 汇总：${gates.length} 个门岗 · `
      + `${gates.length - failures.length - advisoryFailures.length} 通过 · `
      + `${failures.length} 阻断失败 · ${advisoryFailures.length} advisory 失败 · ${totalSeconds}s\n`,
  )

  if (advisoryFailures.length > 0) {
    write('\n⚠️ advisory 失败（由 main 上的 .github/workflows/docs-autosync.yml 自动补齐，不必为它单开 commit）：\n')
    for (const failure of advisoryFailures) {
      write(`  · ${failure.name}\n`)
      for (const line of failure.tail) write(`      ${line}\n`)
      if (inActions) {
        write(
          `${annotation(
            'warning',
            'docs-autosync',
            `${failure.name} 未通过：这是文档/生成物记账门，合入 main 后由 docs-autosync 工作流自动补齐并回写；`
              + `本 PR 无需为它单开一个 commit。想现在就修：pnpm run ${failure.name}`,
          )}\n`,
        )
      }
    }
  }

  if (failures.length > 0) {
    write(`\n❌ ${failures.length} 个门岗阻断失败：\n`)
    for (const failure of failures) {
      write(`  · ${failure.name}（退出码 ${failure.code}）\n`)
      for (const line of failure.tail) write(`      ${line}\n`)
    }
    write('\n  这一轮已经跑完全部门岗，上面就是**全部**需要修的东西——一次改完，不用一轮推一个。\n')
    return { failures, advisoryFailures, exitCode: 1 }
  }

  write('\n✅ 全部阻断性门岗通过。\n')
  return { failures, advisoryFailures, exitCode: 0 }
}

/** 真实执行体：`pnpm run <name>`，输出边流边收（既能实时看，又能在汇总里回放尾巴）。 */
function spawnGate(name) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const child = spawn(command, ['run', name], {
      cwd: repoRoot,
      shell: process.platform === 'win32',
    })
    let output = ''
    const capture = (chunk) => {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    child.on('error', reject)
    child.on('close', (code, signal) => {
      // 被信号打断（超时/取消）不是「通过」——没有退出码就当失败，fail-closed。
      resolve({ code: code === null ? `signal:${signal}` : code, output })
    })
  })
}

async function main() {
  const { gates, advisory } = parseGateArgs(process.argv.slice(2))
  const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts ?? {}
  assertGatesExist(gates, scripts)
  const { exitCode } = await runGateSuite({ gates, advisory, runGate: spawnGate })
  process.exit(exitCode)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof GateConfigError) {
      console.error(`✖ gates:contracts 配置有误：${error.message}`)
      console.error('  → 门岗清单写在 package.json 的 "gates:contracts" 里；改完跑 pnpm run check:gates-chain 复核')
    } else {
      console.error(error)
    }
    process.exit(1)
  })
}
