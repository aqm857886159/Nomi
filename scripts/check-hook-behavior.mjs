#!/usr/bin/env node
import { makeTempDir } from './_test-temp.mjs'
// Bash 闸门行为契约门岗（2026-09-02；2026-10-24 推送前的本机门岗戳删除后改写）。每一轴都用**实际执行 hook** 来判，
// 不读它的源码文本：
//   轴 B｜push 命令识别——「这条命令推不推、推的哪棵树、跳没跳过 git 钩子」必须判对，两个方向都不许错：
//         普通推送不管怎么写都放行、不留痕；跳过 git 钩子的推送每种写法都要把绕口记进**真正被推的那棵树**；
//         有绕口写法却归因不了是哪棵树 → 拦（exit 2）；引号里的词组不算推送。
//   secret-guard 的命令识别矩阵（与 push 闸共用同一个命令理解层，同一类漏判会同时出现在两处）；
//   轴 C｜登记表里每条 hook 命令在**脚本文件不存在**时的退出码（拦截型必 2，提示型必有 stderr）；
//   以及 push 闸输出里让人运行的脚本必须真实存在。
//
// 2026-10-24 随本机门岗戳一起删掉的两轴（P1：加新必删旧）：
//   · 轴 A「戳契约」——写戳方（`pnpm run gates` 末尾的签发脚本）与读戳方（push 闸）必须指同一枚戳；
//   · 轴 D「doc-only 判据认非 ASCII 路径」——doc-only 只用来判「这次推送要不要戳」。
// 用户拍板「改成 CI 把关：推分支前本机只跑快检，完整门岗交给 CI，合并照旧只认 CI 全绿和 main 上的收据」：
// 推送前把关的是 git 的 pre-push 快检（scripts/pre-push-contracts.mjs），本机不再有「完整门岗过了」的凭据可验。
// 读 git 路径列表必须带 -z 这一族，仍由 check:git-path-quoting 守。设计卡 docs/plan/2026-10-24-push-gate-ci.md。
//
// **为什么是「跑」而不是「读」hook**（第一版就是读，栽了）：
// 第一版靠 grep hook 的源码文本判它对不对。两个方向都不成立：
//   · 假绿——要找的字符串在 hook 的**注释里也有**，可执行那行改坏了、注释原样保留（merge 时极常见，
//     注释与代码是两个 hunk），门岗照样打勾。实测确认。
//   · 假红——把一段 shell 换成等价写法，行为完全正确，门岗却报漂移。
//     而 `docs/design/page-design-process.md` 自己写着：会误报的门岗三次之后就被人绕过，等于不存在。
// 所以改成**行为验证**：造临时仓库，把真的 PreToolUse 载荷喂给真的 hook，看退出码和它写下的留痕。
// 任何等价改写都合法，任何真的行为回退都拦得住——注释是骗不过一次真实执行的。
//
// 轴 B 的起因（2026-09-02 实测）：闸门曾用正则 `git[[:space:]]+push` 判断「是不是推送」、
// 用一段 sed 抓**第一个** `cd` 判断「推哪棵树」。四个方向全漏：
//   · `git -C <另一棵树> push` / `git -c k=v push` / `git --no-pager push` —— git 与 push 之间
//     隔了全局选项，正则匹配不到，闸门**根本不运行**；
//   · `cd A && cd B && git push` —— 取第一个 cd，把 B 的推送算到 A 头上；
//   · 反向误伤：`echo "git push"` / `grep -rn "git push" docs/` 被当成推送。
// 根因是用正则理解 shell 语法。现由两个 Bash 闸门共用的 _bash-command-analysis.sh（python3 `shlex`）做词法分析。
// 戳删掉之后「推哪棵树」只剩一个用处：绕口记进哪棵树——记错树，check:push-bypass 就会拦错人、放过真绕口。
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { BLOCKING, hookCommands, hookKind, referencedScript } = createRequire(import.meta.url)('./claude-hooks-registry.cjs')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const HOOK_REL = 'scripts/claude-hooks/pre-push-check.sh'
/** push 闸把绕口记在被推那棵树的这个文件里，`check:push-bypass` 读同一个文件。 */
const BYPASS_LOG_REL = path.join('.claude', 'push-bypass.log')

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/**
 * 造一棵临时仓库：有 origin/main、有一个**代码**改动的 outgoing commit。
 * 这个提交不在任何远端跟踪分支上 = 这次推送带新内容（不带新内容的推送 push 闸不留痕，验不到归因）。
 */
function makeProbeRepo() {
  const dir = makeTempDir('nomi-push-probe-')
  git(['init', '-q', '-b', 'main'], dir)
  git(['config', 'user.email', 'probe@example.com'], dir)
  git(['config', 'user.name', 'probe'], dir)
  fs.writeFileSync(path.join(dir, 'code.mjs'), 'export const a = 1\n')
  git(['add', '-A'], dir)
  git(['commit', '-q', '--no-verify', '-m', 'base'], dir)
  // 让 origin/main 存在且停在 base，后面那个 commit 就成了「远端还不认识的 outgoing」。
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir)
  fs.writeFileSync(path.join(dir, 'code.mjs'), 'export const a = 2\n')
  git(['add', '-A'], dir)
  git(['commit', '-q', '--no-verify', '-m', 'outgoing code change'], dir)
  return dir
}

/** 把真实的 PreToolUse 载荷喂给真实的 hook，返回它的退出码。 */
function runHookScript(hookPath, cwd, command = 'git push -u origin HEAD') {
  const payload = JSON.stringify({ tool_input: { command }, cwd })
  try {
    execFileSync('bash', [hookPath], { input: payload, cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return 0
  } catch (error) {
    return typeof error.status === 'number' ? error.status : 1
  }
}

function bypassRecordCount(dir) {
  const log = path.join(dir, BYPASS_LOG_REL)
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((line) => line.trim()).length : 0
}

/**
 * 轴 B：push 命令识别矩阵。
 *
 * `a` 是 harness 报的会话目录，`b` 是另一棵树；两棵都有远端还不认识的代码提交，**都没跑过 gates、
 * 都没有任何戳**——推送前把关是 git 的 pre-push 快检，这里不许再要求任何本机凭据。
 * 每条给出命令、期望退出码、以及期望哪几棵树各被记了一条绕口（空 = 一条都不该记）。
 * 写法清单不是假想用例：block / 漏判那几类全是 2026-09-02 实测漏过的形式，引号那几条是实测误伤过的只读命令。
 */
function commandMatrix(a, b) {
  const quote = value => "'" + value.split(path.sep).join('/').replaceAll("'", "'\\''") + "'"
  const shellA = quote(a)
  const shellB = quote(b)
  return [
    // —— 普通推送：不管怎么写都放行、都不留痕 ——
    { cmd: 'git push -u origin HEAD', cwd: a, exit: 0, records: [], label: '基线：普通推送（本树从没跑过 gates、没有任何戳）' },
    { cmd: `git -C ${shellB} push`, cwd: a, exit: 0, records: [], label: '`git -C <另一棵树> push`' },
    { cmd: 'git -c core.pager=cat push', cwd: a, exit: 0, records: [], label: '`git -c k=v push`' },
    { cmd: 'git --no-pager push', cwd: a, exit: 0, records: [], label: '`git --no-pager push`' },
    { cmd: `cd ${shellA} && cd ${shellB} && git push`, cwd: a, exit: 0, records: [], label: '多个 cd 之后普通推送' },
    { cmd: `git --git-dir=${shellB}/.git push`, cwd: a, exit: 0, records: [], label: '`--git-dir` 普通推送（git 钩子照跑，不用归因）' },
    { cmd: 'git push "unbalanced', cwd: a, exit: 0, records: [], label: '引号不配对、没有绕口写法' },

    // —— 跳过 git 钩子：每种写法都要把绕口记进真正被推的那棵树 ——
    { cmd: 'git push --no-verify', cwd: a, exit: 0, records: [a], label: '基线 `push --no-verify`' },
    { cmd: 'git --no-verify push', cwd: a, exit: 0, records: [a], label: '`git --no-verify push`（选项写在子命令前）' },
    { cmd: `git -C ${shellB} push --no-verify`, cwd: a, exit: 0, records: [b], label: '`git -C <另一棵树> push --no-verify`' },
    { cmd: 'git -c core.pager=cat push --no-verify', cwd: a, exit: 0, records: [a], label: '`git -c k=v push --no-verify`' },
    { cmd: 'git -c core.hooksPath=/dev/null push', cwd: a, exit: 0, records: [a], label: '`git -c core.hooksPath=… push`' },
    {
      cmd: 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push',
      cwd: a,
      exit: 0,
      records: [a],
      label: '环境变量形式的 core.hooksPath',
    },
    { cmd: `cd ${shellA} && cd ${shellB} && git push --no-verify`, cwd: a, exit: 0, records: [b], label: '多个 cd：末个才是推送地' },
    { cmd: `(cd ${shellB} && git push --no-verify)`, cwd: a, exit: 0, records: [b], label: '子 shell 里的 cd + 推送' },
    { cmd: 'sudo git push --no-verify', cwd: a, exit: 0, records: [a], label: 'sudo 等包装命令' },
    { cmd: 'echo start\ngit push --no-verify', cwd: a, exit: 0, records: [a], label: '多行命令的第二行' },
    {
      cmd: `cd ${shellA} && git push --no-verify && cd ${shellB} && git push --no-verify`,
      cwd: a,
      exit: 0,
      records: [a, b],
      label: '一条命令推两棵，各记各的',
    },

    // —— 有绕口写法却归因不了 → fail-closed ——
    { cmd: `git --git-dir=${shellB}/.git push --no-verify`, cwd: a, exit: 2, records: [], label: '`--git-dir` + 绕口（还原不了是哪棵树）' },
    { cmd: 'git push --no-verify "unbalanced', cwd: a, exit: 2, records: [], label: '引号不配对 + 绕口' },

    // —— 根本不是推送 ——
    { cmd: 'echo "git push --no-verify is a command"', cwd: a, exit: 0, records: [], label: '引号内出现该词组（echo）' },
    { cmd: 'grep -rn "git push --no-verify" docs/', cwd: a, exit: 0, records: [], label: '引号内出现该词组（grep）' },
    { cmd: 'git log --grep="git push --no-verify"', cwd: a, exit: 0, records: [], label: 'git log --grep 该词组' },
    { cmd: 'git status', cwd: a, exit: 0, records: [], label: '其它 git 子命令' },
  ]
}

function checkCommandDetection(root, problems) {
  const hookPath = path.join(root, HOOK_REL)
  if (!fs.existsSync(hookPath)) {
    problems.push(`push 闸 ${HOOK_REL} 不存在——绕口留痕没有版本化的实现体。`)
    return
  }
  const a = makeProbeRepo()
  const b = makeProbeRepo()
  const name = (dir) => (dir === a ? 'A 树' : 'B 树')
  try {
    for (const { cmd, cwd, exit, records, label } of commandMatrix(a, b)) {
      for (const dir of [a, b]) fs.rmSync(path.join(dir, BYPASS_LOG_REL), { force: true })
      const status = runHookScript(hookPath, cwd, cmd)
      const recorded = [a, b].filter((dir) => bypassRecordCount(dir) > 0)
      if (status !== exit) {
        problems.push(
          exit === 0
            ? `命令识别误伤：${label} —— 闸门拦了本该放行的命令（退出码 ${status}）。推送前把关的是 git 的 pre-push 快检，` +
                `这里只留痕；会误报的闸门用不了几次就会被人绕过（见 docs/design/page-design-process.md）。`
            : `命令识别漏判：${label} —— 有绕口写法却归因不了是哪棵树，闸门仍放行了（退出码 ${status}，应为 ${exit}）：` +
                `记不下来的绕口不许放行。`,
        )
      }
      const missing = records.filter((dir) => !recorded.includes(dir))
      const extra = recorded.filter((dir) => !records.includes(dir))
      if (missing.length > 0) {
        problems.push(
          `命令识别漏判：${label} —— 跳过 git 钩子的推送没记进被推的那棵树（${missing.map(name).join('、')}），` +
            `check:push-bypass 看不见这次绕口。（这类漏判等于闸门对该写法完全不存在。）`,
        )
      }
      if (extra.length > 0) {
        problems.push(
          `命令识别误伤：${label} —— 不该留痕的树被记了一条绕口（${extra.map(name).join('、')}），` +
            `它下一次正常推送会被 check:push-bypass 拦下。`,
        )
      }
    }
  } finally {
    fs.rmSync(a, { recursive: true, force: true })
    fs.rmSync(b, { recursive: true, force: true })
  }
}

/**
 * secret-guard 的识别矩阵。它与 pre-push 共用同一个理解层，所以同一类漏判会同时出现在两处——
 * 2026-09-02 正是先在 pre-push 发现四种带全局选项的写法漏判，追同类入口时才发现
 * secret-guard 一模一样地漏了四种。这里把两边都钉住。
 */
const SECRET_GUARD_MATRIX = [
  { cmd: 'git commit --no-verify -m x', expect: 'block', label: '基线 `commit --no-verify`' },
  { cmd: 'git commit -n -m x', expect: 'block', label: '基线 `commit -n`' },
  { cmd: 'git commit -nm x', expect: 'block', label: '短选项簇 `-nm` 含 n' },
  { cmd: 'git -c core.pager=cat commit --no-verify -m x', expect: 'block', label: '`git -c` 后再 --no-verify' },
  { cmd: 'git -C /tmp commit --no-verify -m x', expect: 'block', label: '`git -C` 后再 --no-verify' },
  { cmd: 'git --no-pager commit --no-verify -m x', expect: 'block', label: '`git --no-pager` 后再 --no-verify' },
  { cmd: 'git add -f secret.db', expect: 'block', label: '基线 `add -f`' },
  { cmd: 'git -c x=y add --force secret.db', expect: 'block', label: '`git -c` 后再 `add --force`' },
  { cmd: 'echo "git commit --no-verify"', expect: 'allow', label: '引号内出现该词组' },
  { cmd: 'git commit -m x', expect: 'allow', label: '正常提交' },
  { cmd: 'git add -A', expect: 'allow', label: '正常 add' },
]

function checkSecretGuard(root, problems) {
  const hookPath = path.join(root, 'scripts/claude-hooks/secret-guard.sh')
  if (!fs.existsSync(hookPath)) return
  for (const { cmd, expect, label } of SECRET_GUARD_MATRIX) {
    const blocked = runHookScript(hookPath, os.tmpdir(), cmd) !== 0
    if (expect === 'block' && !blocked) {
      problems.push(
        `secret-guard 漏判：${label} —— 放行了会跳过 pre-commit 敏感数据扫描的命令。` +
          `（微信记录 / db_key 正是靠那道扫描挡住不进公开仓库的。）`,
      )
    }
    if (expect === 'allow' && blocked) {
      problems.push(`secret-guard 误伤：${label} —— 拦了本该放行的命令。`)
    }
  }
}

/**
 * 轴 C｜登记表里的每条命令，在**脚本文件不存在**时到底怎么退出（2026-09-07）。
 *
 * 起因：一棵落后 main 的 worktree，`.claude/settings.json` 里登记着
 * `bash "$CLAUDE_PROJECT_DIR/scripts/claude-hooks/commit-bypass-check.sh"`，
 * 而那棵树上没有这个文件 → bash 退 **127** → Claude Code 只认 exit 2 是阻断，
 * 127 归为「hook 出错，继续」→ 子 agent 的 `git -c core.hooksPath=… commit` 畅通无阻。
 * 闸门在登记表里活着、在现实里不存在，全程零句红。
 *
 * 结构面（命令串长不长成规范守卫）由 `check:claude-hooks` 逐字比对；这里做的是**行为**面的
 * 阳性对照：真的把脚本挪走（拿一个没有 `scripts/claude-hooks/` 的空目录当 `CLAUDE_PROJECT_DIR`），
 * 真的喂一条 PreToolUse 载荷跑那条命令，看退出码。
 * 结构对了行为不对，是这仓栽过很多次的假绿——所以两道都要。
 */
const GUARD_PROBE_COMMAND = 'git -c core.hooksPath=/dev/null commit -m x'

/** 一条无害载荷：九个 hook 拿到它都该原样放行（没有推送、没有绕口、不是 package.json、没有转录）。 */
function benignPayload(cwd) {
  return JSON.stringify({ tool_input: { command: 'git status', file_path: '/tmp/nomi-guard-probe.txt' }, cwd })
}

/** 用真实的 shell 跑 settings 里那条命令串（harness 就是这么跑的），返回退出码与 stderr。 */
function runSettingsCommand(command, { projectDir, cwd, payload }) {
  const result = spawnSync('bash', ['-c', command], {
    input: payload,
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  })
  return { status: typeof result.status === 'number' ? result.status : 1, stderr: result.stderr ?? '' }
}

function checkSettingsGuards(root, problems) {
  const settingsPath = path.join(root, '.claude', 'settings.json')
  if (!fs.existsSync(settingsPath)) {
    problems.push('.claude/settings.json 不存在——hook 登记表没有版本化的真相源，什么都验不了。')
    return
  }
  let settings
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch (error) {
    problems.push(`.claude/settings.json 解析失败：${error.message}`)
    return
  }
  const commands = hookCommands(settings.hooks)
  if (commands.length === 0) {
    problems.push('.claude/settings.json 里一条 hook 都没登记——闸门全下线。')
    return
  }

  // 「脚本被挪走」的现场：一个存在、但里面没有 scripts/claude-hooks/ 的项目根。
  const stripped = makeTempDir('nomi-hook-missing-')
  try {
    for (const command of commands) {
      const script = referencedScript(command)
      if (!script) {
        problems.push(`hook 命令认不出它调的脚本，缺失行为无从验证：${command}`)
        continue
      }
      const scriptPath = path.join(root, script)
      if (!fs.existsSync(scriptPath)) {
        problems.push(`hook 指向的脚本不存在：${script}`)
        continue
      }
      const kind = hookKind(fs.readFileSync(scriptPath, 'utf8'))
      const label = `${script}（${kind === BLOCKING ? '拦截型' : '提示型'}）`

      // 阳性对照：脚本不在场。
      const missing = runSettingsCommand(command, {
        projectDir: stripped,
        cwd: stripped,
        payload: JSON.stringify({ tool_input: { command: GUARD_PROBE_COMMAND }, cwd: stripped }),
      })
      if (kind === BLOCKING) {
        if (missing.status !== 2) {
          problems.push(
            `${label} 的脚本不在场时退出码是 ${missing.status}，不是 2——Claude Code 只把 2 当阻断，` +
              `其余（含裸 bash 的 127）一律「hook 出错，继续」，等于闸门静默放行。` +
              `这正是 2026-09-07 那棵落后 worktree 上发生的事。`,
          )
        }
      } else if (missing.status === 2) {
        problems.push(
          `${label} 的脚本不在场时 exit 2 阻断了——提示型不该把人锁死（Stop 上尤其会变成想修都停不下来的死循环）。`,
        )
      } else if (missing.status === 0 || missing.stderr.trim() === '') {
        problems.push(
          `${label} 的脚本不在场时既不报错也没有一句 stderr——可以 fail-open，不可以 fail-silent：` +
            `少了一层提醒必须让人看得见。`,
        )
      }

      // 负向对照：脚本在场 + 无害载荷 → 必须原样放行。守卫不许退化成「拦一切」，
      // 会误报的闸门用不了几次就会被人绕过（见 docs/design/page-design-process.md）。
      const present = runSettingsCommand(command, {
        projectDir: root,
        cwd: root,
        payload: benignPayload(root),
      })
      if (present.status !== 0) {
        problems.push(`${label} 在脚本正常在场、载荷无害时退出码是 ${present.status}，本该 0——守卫误伤了正常调用。`)
      }
    }
  } finally {
    fs.rmSync(stripped, { recursive: true, force: true })
  }
}

/** 全部轴。门岗跑全套；单元测试按 `only` 只跑它要验的那一轴（每轴都要实跑 hook，很贵）。 */
export const AXES = ['push-commands', 'secret-guard', 'suggestion', 'settings-guard']

export function checkHookBehavior(root = repoRoot, { only = AXES } = {}) {
  const problems = []
  const run = (axis) => only.includes(axis)

  if (run('push-commands')) checkCommandDetection(root, problems)
  if (run('secret-guard')) checkSecretGuard(root, problems)
  if (run('settings-guard')) checkSettingsGuards(root, problems)

  // push 闸输出里让人运行的脚本必须真实存在（历史上它让人跑过一个根本不存在的补盖脚本）。
  if (run('suggestion')) {
    const hookPath = path.join(root, HOOK_REL)
    if (fs.existsSync(hookPath)) {
      const hook = fs.readFileSync(hookPath, 'utf8')
      for (const match of hook.matchAll(/node\s+\.?\/?(scripts\/[\w./-]+\.(?:mjs|cjs|js))/g)) {
        const suggested = match[1]
        if (!fs.existsSync(path.join(root, suggested))) {
          problems.push(`push 闸 ${HOOK_REL} 让人运行 \`node ${suggested}\`，但该文件不存在。`)
        }
      }
    }
  }

  return problems
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkHookBehavior()
  if (problems.length === 0) {
    console.log(
      '✓ Bash 闸门行为契约通过：push 闸的命令识别矩阵（普通推送一律放行、跳过 git 钩子的推送记进被推的那棵树、' +
        '归因不了就拦）+ secret-guard 的命令识别矩阵 + 登记表每条命令在脚本被挪走时的退出码' +
        '（拦截型必 2，提示型必有 stderr）+ push 闸推荐的脚本都在，均已实跑验证。',
    )
    process.exit(0)
  }
  console.error('✖ Bash 闸门行为契约不一致（闸门放行 / 留痕的行为与契约对不上，且这类失效本身不报错）:')
  for (const line of problems) console.error(`  - ${line}`)
  console.error(`\n  → push 闸的契约：推送前把关是 git 的 pre-push 快检，${HOOK_REL} 只给跳过钩子的推送留痕（见文件头）。`)
  process.exit(1)
}
