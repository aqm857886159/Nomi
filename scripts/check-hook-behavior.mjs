#!/usr/bin/env node
// push 闸行为契约门岗（2026-09-02）。守两条轴，都用**实际执行 hook** 来判，不读它的源码文本：
//   轴 A｜戳契约——写戳方（gates）与读戳方（pre-push hook）必须指同一枚戳；
//   轴 B｜命令识别——「这条命令推不推、推的哪棵树」必须判对，两个方向都不许错。
//
// 轴 A 的起因：戳的路径和字段名被写死在三个互不相识的地方（gates 的内联写入、pre-push hook 的解析、
// hook 拦人时给的手动补盖命令）。2026-09-02 只升级了读戳方，另外两处没动——
// 结果 `pnpm run gates` 全过仍然推不上去，而且**两边各自看都是"对的"**：
// gates 说盖好了戳、hook 说没有戳，谁都没报错。20+ 棵 worktree 上天天复发。
//
// 起因：戳的路径和字段名被写死在三个互不相识的地方（gates 的内联写入、pre-push hook 的解析、
// hook 拦人时给的手动补盖命令）。2026-09-02 只升级了读戳方，另外两处没动——
// 结果 `pnpm run gates` 全过仍然推不上去，而且**两边各自看都是"对的"**：
// gates 说盖好了戳、hook 说没有戳，谁都没报错。20+ 棵 worktree 上天天复发。
//
// **为什么是「跑」而不是「读」读戳方**（第一版就是读，栽了）：
// 第一版靠 grep hook 的源码文本（找 `nomi-gates-ok`、`--absolute-git-dir`、`s/^sha=//p`）。
// 两个方向都不成立：
//   · 假绿——这些字符串在 hook 的**注释里也有**。把可执行那行改回 `MARKER="$ROOT/.claude/.gates-ok"`
//     而注释原样保留（merge 时极常见，注释与代码是两个 hunk），门岗照样打勾。实测确认。
//   · 假红——把 sed 换成等价的 awk / read 循环，行为完全正确，门岗却报「漏读 sha 字段」。
//     而 `docs/design/page-design-process.md` 自己写着：会误报的门岗三次之后就被人绕过，等于不存在。
// 所以改成**行为验证**：造一棵临时仓库，用唯一书写者盖出真戳，然后把真的
// `git push` 载荷喂给真的 hook，看它到底放行还是拦。这样任何等价改写都合法，
// 而任何真的行为回退都拦得住——注释是骗不过一次真实执行的。
//
// 轴 B 的起因（同日第二轮实测）：闸门用正则 `git[[:space:]]+push` 判断「是不是推送」、
// 用一段 sed 抓**第一个** `cd` 判断「推哪棵树」。四个方向全漏：
//   · `git -C <另一棵树> push` / `git -c k=v push` / `git --no-pager push` —— git 与 push 之间
//     隔了全局选项，正则匹配不到，闸门**根本不运行**；本树的有效戳于是给另一棵没过五门的树背书；
//   · `cd A && cd B && git push` —— 取第一个 cd，拿 A 的戳判 B 的推送；
//   · 反向误伤：`echo "git push"` / `grep -rn "git push" docs/` 被当成推送拦下。
// 根因是用正则理解 shell 语法。现由 hook 内的 python3 用 `shlex` 做词法分析。
//
// 规矩（以 `scripts/stamp-gates-ok.mjs` 为准）：
//   ① `gates` 必须调用那个唯一书写者，且不得再内联写任何别的戳；
//   ② 读戳方必须认唯一书写者盖出的戳（放行），且**每一个身份字段被篡改时都必须拦**；
//   ③ 无戳、老格式戳、别棵树的戳，一律拦；
//   ④ 读戳方拦人时推荐的补盖命令，指向的文件必须真的存在；
//   ⑤ 命令识别矩阵逐条对：该拦的拦、该放的放（含引号内词组不算推送）。
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MARKER_BASENAME, STAMP_KEYED_FIELDS, resolveMarkerPath, writeStamp } from './stamp-gates-ok.mjs'

const { BLOCKING, hookCommands, hookKind, referencedScript } = createRequire(import.meta.url)('./claude-hooks-registry.cjs')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const STAMPER_REL = 'scripts/stamp-gates-ok.mjs'
const HOOK_REL = 'scripts/claude-hooks/pre-push-check.sh'

/** 老的戳文件名。它一旦在 gates 里复活，就又是一个没人读的平行戳（P1）。 */
const LEGACY_MARKER = '.gates-ok'

/**
 * 每个身份字段怎么「篡改」——用来证明读戳方**真的在校验它**。
 *
 * 往 STAMP_KEYED_FIELDS 加字段却不在这里给出篡改方式 → 报红。
 * 这是刻意的：新增一个身份维度，就得证明它真的在把关，否则它只是写进了文件而已。
 */
const FIELD_TAMPERS = {
  // 盖完戳之后又提交了代码：戳记的 sha 落在父提交上。
  sha: (dir) => execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: dir, encoding: 'utf8' }).trim(),
  // 戳是从别棵 worktree 拷来的。
  worktree: () => path.join(os.tmpdir(), 'nomi-some-other-worktree'),
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/**
 * 造一棵临时仓库：有 origin/main、有一个**代码**改动的 outgoing commit
 *（doc-only 的改动 hook 会直接放行，验不到戳）。
 */
function makeProbeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-gates-probe-'))
  git(['init', '-q', '-b', 'main'], dir)
  git(['config', 'user.email', 'probe@example.com'], dir)
  git(['config', 'user.name', 'probe'], dir)
  fs.writeFileSync(path.join(dir, 'code.mjs'), 'export const a = 1\n')
  git(['add', '-A'], dir)
  git(['commit', '-q', '--no-verify', '-m', 'base'], dir)
  // 让 origin/main 存在且停在 base，后面那个 commit 就成了「有代码的 outgoing」。
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir)
  fs.writeFileSync(path.join(dir, 'code.mjs'), 'export const a = 2\n')
  git(['add', '-A'], dir)
  git(['commit', '-q', '--no-verify', '-m', 'outgoing code change'], dir)
  return dir
}

/**
 * 造一棵 outgoing 只有**文档**的临时仓库，文件名由调用方给（含非 ASCII 的那一路是重点）。
 * `extraPaths` 里塞一个代码文件，就成了「文档 + 代码」的反面用例。
 */
function makeDocsProbeRepo({ docPath, extraPaths = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-docs-probe-'))
  git(['init', '-q', '-b', 'main'], dir)
  git(['config', 'user.email', 'probe@example.com'], dir)
  git(['config', 'user.name', 'probe'], dir)
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n')
  git(['add', '-A'], dir)
  git(['commit', '-q', '--no-verify', '-m', 'base'], dir)
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir)
  for (const rel of [docPath, ...extraPaths]) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, 'x\n')
  }
  git(['add', '-A'], dir)
  git(['commit', '-q', '--no-verify', '-m', 'outgoing docs change'], dir)
  return dir
}

/** 把真实的 PreToolUse 载荷喂给真实的 hook，返回它的退出码。 */
function runHook(hookPath, cwd, command = 'git push -u origin HEAD') {
  const payload = JSON.stringify({ tool_input: { command }, cwd })
  try {
    execFileSync('bash', [hookPath], { input: payload, cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return 0
  } catch (error) {
    return typeof error.status === 'number' ? error.status : 1
  }
}

function setField(dir, field, value) {
  const marker = resolveMarkerPath(dir)
  const body = fs
    .readFileSync(marker, 'utf8')
    .split('\n')
    .map((line) => (line.startsWith(`${field}=`) ? `${field}=${value}` : line))
    .join('\n')
  fs.writeFileSync(marker, body)
}

/** ② ③ 行为验证：真的跑读戳方。 */
function checkReaderBehaviour(root, problems) {
  const hookPath = path.join(root, HOOK_REL)
  if (!fs.existsSync(hookPath)) {
    problems.push(`读戳方 ${HOOK_REL} 不存在——push 闸没有版本化的实现体。`)
    return
  }
  const dir = makeProbeRepo()
  try {
    // ② 唯一书写者盖出的戳，读戳方必须认。
    writeStamp(dir)
    if (runHook(hookPath, dir) !== 0) {
      problems.push(
        `读戳方不认 ${STAMPER_REL} 盖出的戳（本该放行却拦了）——` +
          `这正是「gates 全过也推不上去」那个 bug 的形状。`,
      )
    }

    // ② 每一个身份字段被篡改，都必须拦；没给篡改方式的字段一律报红。
    for (const field of STAMP_KEYED_FIELDS) {
      const tamper = FIELD_TAMPERS[field]
      if (!tamper) {
        problems.push(
          `STAMP_KEYED_FIELDS 里的 \`${field}\` 没有对应的篡改用例（FIELD_TAMPERS 漏了）——` +
            `无法证明读戳方真的在校验它，新增身份维度必须可被证伪。`,
        )
        continue
      }
      writeStamp(dir)
      setField(dir, field, tamper(dir))
      if (runHook(hookPath, dir) === 0) {
        problems.push(`读戳方没有校验戳里的 \`${field}=\`——篡改它之后依然放行，闸门少一维。`)
      }
    }

    // ③ 无戳必须拦。
    fs.rmSync(resolveMarkerPath(dir), { force: true })
    if (runHook(hookPath, dir) === 0) {
      problems.push('读戳方在**没有戳**时依然放行——有代码改动却不需要过五门。')
    }

    // ③ 老格式（只有时间戳）的戳不能当凭据。
    fs.writeFileSync(resolveMarkerPath(dir), `${new Date().toISOString()}\n`)
    if (runHook(hookPath, dir) === 0) {
      problems.push('读戳方把老格式（只有时间戳）的戳当成了有效凭据——那种戳不认树也不认提交。')
    }

    // ③ 一树一戳：别棵 worktree 盖的戳不能给本树背书。
    const sibling = path.join(dir, '..', `${path.basename(dir)}-sibling`)
    git(['worktree', 'add', '-q', '-b', 'sibling', sibling], dir)
    try {
      writeStamp(dir) // 只给主树盖戳
      if (runHook(hookPath, sibling) === 0) {
        problems.push(
          `读戳方让**另一棵 worktree** 的戳给本次推送背书了——戳必须落在各自的 ` +
            `\`git rev-parse --absolute-git-dir\`（即 ${MARKER_BASENAME} 一树一份），否则多 worktree 下既误放也误杀。`,
        )
      }
    } finally {
      git(['worktree', 'remove', '--force', sibling], dir)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 轴 D：doc-only 放行的判据必须**认得非 ASCII 路径**（2026-09-07 实测栽过）。
 *
 * git 默认 `core.quotePath=true`：`--name-only` 把 `docs/中文附件.md` 输出成
 * `"docs/\\344\\270\\255\\346\\226\\207\\351\\231\\204\\344\\273\\266.md"`——首尾各一个引号，中间八进制转义。
 * 闸门那把尺（`^docs/` / `\\.md$`）两头都被引号挡掉，于是纯中文文档改动被判成「有代码改动」，
 * docs-only 的推送白等一遍五门。方向上是多跑门岗不是绕过，所以本地一路绿、只有人在等。
 *
 * 两条都必须在：只验「中文 → 放行」会被一个「永远放行」的实现骗过（假绿），
 * 所以配一条「中文文档 + 一个 .ts → 必须拦」的反面对照钉住尺子还在量。
 */
const DOCS_ONLY_MATRIX = [
  { label: 'ASCII 文档：基线', docPath: 'docs/plain-note.md', extraPaths: [], expect: 'allow' },
  { label: '非 ASCII 文档名（quotePath 转义那一族）', docPath: 'docs/中文附件说明.md', extraPaths: [], expect: 'allow' },
  { label: '路径含空格', docPath: 'docs/note with space.md', extraPaths: [], expect: 'allow' },
  { label: '非 ASCII 文档 + 一个 .ts —— 反面对照，必须拦', docPath: 'docs/中文附件说明.md', extraPaths: ['src/a.ts'], expect: 'block' },
]

function checkDocsOnlyDetection(root, problems) {
  const hookPath = path.join(root, HOOK_REL)
  if (!fs.existsSync(hookPath)) return
  for (const { label, docPath, extraPaths, expect } of DOCS_ONLY_MATRIX) {
    const dir = makeDocsProbeRepo({ docPath, extraPaths })
    try {
      // 一枚戳都不盖：doc-only 判真才会放行，判假就一定撞「没有戳」而被拦。
      const blocked = runHook(hookPath, dir) !== 0
      if (expect === 'allow' && blocked) {
        problems.push(
          `doc-only 误判：${label} —— outgoing 全是文档却被要求过五门。` +
            `多半是按行读了 \`git diff --name-only\`（默认 quotePath 会把非 ASCII 路径转义并加引号），` +
            `应当用 \`-z\` 按 NUL 读。`,
        )
      }
      if (expect === 'block' && !blocked) {
        problems.push(`doc-only 漏判：${label} —— 混着代码改动却按 doc-only 放行了，闸门等于不存在。`)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

/**
 * 轴 B：命令识别矩阵。
 *
 * `stamped` = 已过五门的树，`bare` = 有代码但没盖戳的树。
 * 每条给出命令、hook 报的 cwd、以及期望是拦（block）还是放行（allow）。
 * 这些不是假想用例——block 那几条全部是 2026-09-02 实测漏过的形式，
 * allow 那几条是实测误伤过的只读命令。
 */
function commandMatrix(stamped, bare) {
  const push = 'git push'
  return [
    // —— 该拦：推的是没过五门的那棵 ——
    { cmd: `${push} -u origin HEAD`, cwd: bare, expect: 'block', label: '基线：直接推送未过门的树' },
    { cmd: `git -C ${bare} push`, cwd: stamped, expect: 'block', label: '`git -C <另一棵树> push`' },
    { cmd: `git -c core.pager=cat push`, cwd: bare, expect: 'block', label: '`git -c k=v push`' },
    { cmd: `git --no-pager push`, cwd: bare, expect: 'block', label: '`git --no-pager push`' },
    { cmd: `cd ${stamped} && cd ${bare} && ${push}`, cwd: stamped, expect: 'block', label: '多个 cd：末个才是推送地' },
    { cmd: `(cd ${bare} && ${push})`, cwd: stamped, expect: 'block', label: '子 shell 里的 cd + 推送' },
    { cmd: `sudo ${push}`, cwd: bare, expect: 'block', label: 'sudo 等包装命令' },
    { cmd: `FOO=1 ${push}`, cwd: bare, expect: 'block', label: '前置环境变量赋值' },
    { cmd: `git --git-dir=${bare}/.git push`, cwd: stamped, expect: 'block', label: '--git-dir 指定（还原不了→拦）' },
    { cmd: `cd ${stamped} && ${push} && cd ${bare} && ${push}`, cwd: stamped, expect: 'block', label: '一条命令推两棵，其一不合格' },
    { cmd: `${push} "unbalanced`, cwd: bare, expect: 'block', label: '引号不配对 → fail-closed' },

    // —— 该放：根本不是推送，或推的是已过门的那棵 ——
    { cmd: `echo "${push} is a command"`, cwd: bare, expect: 'allow', label: '引号内出现该词组（echo）' },
    { cmd: `grep -rn "${push}" docs/`, cwd: bare, expect: 'allow', label: '引号内出现该词组（grep）' },
    { cmd: `git log --grep="${push}"`, cwd: bare, expect: 'allow', label: 'git log --grep 该词组' },
    { cmd: 'git status', cwd: bare, expect: 'allow', label: '其它 git 子命令' },
    { cmd: `${push} -u origin HEAD`, cwd: stamped, expect: 'allow', label: '推已过门的树' },
    { cmd: `git -C ${stamped} push`, cwd: bare, expect: 'allow', label: '`git -C` 指向已过门的树' },
  ]
}

function checkCommandDetection(root, problems) {
  const hookPath = path.join(root, HOOK_REL)
  if (!fs.existsSync(hookPath)) return
  const stamped = makeProbeRepo()
  const bare = makeProbeRepo()
  try {
    writeStamp(stamped) // 只有它过了五门
    for (const { cmd, cwd, expect, label } of commandMatrix(stamped, bare)) {
      const blocked = runHook(hookPath, cwd, cmd) !== 0
      if (expect === 'block' && !blocked) {
        problems.push(
          `命令识别漏判：${label} —— 闸门放行了一棵**没过五门**的树。` +
            `（这类漏判等于闸门对该写法完全不存在。）`,
        )
      }
      if (expect === 'allow' && blocked) {
        problems.push(
          `命令识别误伤：${label} —— 闸门拦了本该放行的命令。` +
            `会误报的闸门用不了几次就会被人绕过（见 docs/design/page-design-process.md）。`,
        )
      }
    }
  } finally {
    fs.rmSync(stamped, { recursive: true, force: true })
    fs.rmSync(bare, { recursive: true, force: true })
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
    const blocked = runHook(hookPath, os.tmpdir(), cmd) !== 0
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
  const stripped = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-hook-missing-'))
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
export const AXES = ['writer', 'stamp', 'push-commands', 'docs-only', 'secret-guard', 'suggestion', 'settings-guard']

export function checkHookBehavior(root = repoRoot, { only = AXES } = {}) {
  const problems = []
  const run = (axis) => only.includes(axis)

  // ① 写戳方：gates 必须走唯一书写者，且不得内联复活老戳。
  if (run('writer')) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const gates = pkg.scripts?.gates ?? ''
    if (!gates.includes(STAMPER_REL)) {
      problems.push(`package.json 的 \`gates\` 没有调用 ${STAMPER_REL}——五门过了却不盖戳，push 必被拦。`)
    }
    if (gates.includes(LEGACY_MARKER)) {
      problems.push(
        `package.json 的 \`gates\` 仍在写老戳 \`${LEGACY_MARKER}\`——没有任何读戳方读它，` +
          `留着就是第二个平行戳（P1：加新必删旧）。`,
      )
    }
  }

  if (run('stamp')) checkReaderBehaviour(root, problems)
  if (run('push-commands')) checkCommandDetection(root, problems)
  if (run('docs-only')) checkDocsOnlyDetection(root, problems)
  if (run('secret-guard')) checkSecretGuard(root, problems)
  if (run('settings-guard')) checkSettingsGuards(root, problems)

  // ④ 拦人时给的补盖命令必须指向真实存在的文件（历史上它指了个不存在的脚本）。
  if (run('suggestion')) {
    const hookPath = path.join(root, HOOK_REL)
    if (fs.existsSync(hookPath)) {
      const hook = fs.readFileSync(hookPath, 'utf8')
      for (const match of hook.matchAll(/node\s+\.?\/?(scripts\/[\w./-]+\.(?:mjs|cjs|js))/g)) {
        const suggested = match[1]
        if (!fs.existsSync(path.join(root, suggested))) {
          problems.push(`读戳方 ${HOOK_REL} 让人运行 \`node ${suggested}\`，但该文件不存在。`)
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
      `✓ Bash 闸门行为契约通过：戳契约（gates 写、hook 读，同一个 ${MARKER_BASENAME}）` +
        ` + pre-push 与 secret-guard 的命令识别矩阵 + doc-only 判据（含非 ASCII 路径）` +
        ` + 登记表每条命令在脚本被挪走时的退出码（拦截型必 2，提示型必有 stderr），均已实跑验证。`,
    )
    process.exit(0)
  }
  console.error('✖ 五门戳契约不一致（写戳方与读戳方对不上 → gates 全过也推不上去，且两边都不报错）:')
  for (const line of problems) console.error(`  - ${line}`)
  console.error(`\n  → 戳的路径与字段名以 ${STAMPER_REL} 为唯一真相源；改契约就把两边一起改。`)
  process.exit(1)
}
