import { makeTempDir } from './_test-temp.mjs'
// Bash 闸门行为契约门岗（check-hook-behavior.mjs）的类级回归测试（2026-09-02；2026-10-24 推送前的本机门岗戳删除后改写）。
//
// 门岗自己的两个方向都要钉住（第一版两边都栽过，见 check-hook-behavior.mjs 的注释）：
//   · 不许假绿——把 hook 的行为改坏（推送重新要本机凭据 / 绕口记错树 / 普通推送也留痕 / 归因不了还放行 /
//     共用理解层退化），门岗必须报红；
//   · 不许假红——仓库当前的 hook 与登记表必须原样通过。
// 2026-10-24 随本机门岗戳与它的读写方同一个提交删掉的用例：写戳方 / 读戳方漂移、读戳方的 sed→awk 等价改写、
// doc-only 判据（只用来判「要不要戳」）。读 git 路径必须带 -z 这一族仍由 check:git-path-quoting 的测试守。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkHookBehavior } from './check-hook-behavior.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK_REL = 'scripts/claude-hooks/pre-push-check.sh'
const GUARD_REL = 'scripts/claude-hooks/secret-guard.sh'
const LIB_REL = 'scripts/claude-hooks/_bash-command-analysis.sh'
/** push 闸让人运行的确认命令指向它；「推荐的脚本必须存在」那一轴要在夹具里看到它。 */
const AUDIT_REL = 'scripts/check-push-bypass.mjs'

/**
 * 复制一份仓库的契约面到临时目录，供「单边漂移」用例改写。
 * 注意 hook 必须是真文件——门岗会**实际执行**它。
 */
function makeContractFixture(t, { mutateHook, mutateLib } = {}) {
  const dir = makeTempDir('nomi-hook-contract-')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'scripts', 'claude-hooks'), { recursive: true })
  const hook = fs.readFileSync(path.join(repoRoot, HOOK_REL), 'utf8')
  fs.writeFileSync(path.join(dir, HOOK_REL), mutateHook ? mutateHook(hook) : hook)
  // 两个闸门共用的命令理解层：必须一起复制，否则 hook 会走「理解层缺失」的 fail 分支，
  // 测出来的红就不是我们想验的那个原因了。
  for (const rel of [LIB_REL, GUARD_REL]) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
    fs.writeFileSync(path.join(dir, rel), rel === LIB_REL && mutateLib ? mutateLib(src) : src)
  }
  fs.copyFileSync(path.join(repoRoot, AUDIT_REL), path.join(dir, AUDIT_REL))
  return dir
}

/** 精确替换一段 hook 源码；没命中就让测试当场失败（否则是空转）。 */
function replaceOnce(source, from, to) {
  const next = source.replace(from, to)
  assert.notEqual(next, source, `替换必须真的命中，否则这条测试是空转：${from}`)
  return next
}

test('仓库当前的 push 闸：普通推送一律放行、绕口记进被推的那棵树、归因不了就拦（不许假红）', (t) => {
  const dir = makeContractFixture(t)
  assert.deepEqual(checkHookBehavior(dir, { only: ['push-commands', 'suggestion'] }), [])
})

test('push 闸退回「推送前要一枚本机凭据」→ 门岗报红（推送前把关只剩 git 的 pre-push 快检）', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) =>
      replaceOnce(
        hook,
        '[ -n "$TARGETS" ] || exit 0   # 没有推送',
        '[ -n "$TARGETS" ] || exit 0   # 没有推送\n[ -f "$(git rev-parse --absolute-git-dir)/push-credential" ] || exit 2',
      ),
  })
  const problems = checkHookBehavior(dir, { only: ['push-commands'] })
  assert.ok(
    problems.some((p) => p.includes('命令识别误伤') && p.includes('基线：普通推送')),
    `没跑过 gates、没有任何凭据的普通推送被拦，必须报出来；实际：${JSON.stringify(problems)}`,
  )
})

test('绕口记错树（取会话目录而不是解析出的推送目标）→ 门岗报红', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) =>
      replaceOnce(
        hook,
        `_target_root="$(git -C "$_target" rev-parse --show-toplevel 2>/dev/null || echo '')"`,
        `_target_root="$(git rev-parse --show-toplevel 2>/dev/null || echo '')"`,
      ),
  })
  const problems = checkHookBehavior(dir, { only: ['push-commands'] })
  assert.ok(
    problems.some((p) => p.includes('命令识别漏判') && p.includes('`git -C <另一棵树> push --no-verify`') && p.includes('B 树')),
    `推的是 B 树，绕口却记进会话目录 A 树——必须报漏判；实际：${JSON.stringify(problems)}`,
  )
  assert.ok(
    problems.some((p) => p.includes('命令识别误伤') && p.includes('A 树')),
    '多记进 A 树的那一条也必须报出来（它会拦下 A 树下一次正常推送）',
  )
})

test('普通推送也被留痕 → 门岗报红（不该留痕的树下一次推送会被 check:push-bypass 拦下）', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) => replaceOnce(hook, 'has_bypass || exit 0          # 普通推送：git 的 pre-push 快检会自己跑', ':'),
  })
  const problems = checkHookBehavior(dir, { only: ['push-commands'] })
  assert.ok(
    problems.some((p) => p.includes('命令识别误伤') && p.includes('基线：普通推送') && p.includes('不该留痕')),
    `实际：${JSON.stringify(problems)}`,
  )
})

test('有绕口写法却归因不了时放行 → 门岗报红（记不下来的绕口不许放行）', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) =>
      replaceOnce(
        hook,
        '[ "$_target" = "?" ] && block "命令用 --git-dir/--work-tree 指定了推送目标，无法可靠还原是哪棵树。"',
        '[ "$_target" = "?" ] && exit 0',
      ),
  })
  const problems = checkHookBehavior(dir, { only: ['push-commands'] })
  assert.ok(
    problems.some((p) => p.includes('命令识别漏判') && p.includes('`--git-dir` + 绕口')),
    `实际：${JSON.stringify(problems)}`,
  )
})

test('绕口从留痕改成拒绝 → 门岗报红（推送阶段的处置是留痕审计，改它要先改契约）', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) =>
      replaceOnce(hook, 'has_bypass || exit 0          # 普通推送：git 的 pre-push 快检会自己跑', 'has_bypass || exit 0\nexit 2'),
  })
  const problems = checkHookBehavior(dir, { only: ['push-commands'] })
  assert.ok(
    problems.some((p) => p.includes('命令识别误伤') && p.includes('基线 `push --no-verify`')),
    `实际：${JSON.stringify(problems)}`,
  )
})

test('共用理解层不再消费 git 全局选项 → 两个闸门同时报漏判（证明确实共用一份理解）', (t) => {
  const dir = makeContractFixture(t, {
    mutateLib: (lib) => {
      // 拿掉「带参数的 git 全局选项」这一支，`git -c k=v <子命令>` 就退化成认不出子命令。
      // 这正是 2026-09-02 实测到的那类洞：git 与子命令之间隔了全局选项，闸门整个不运行。
      // 这段字面量必须与 _bash-command-analysis.sh 里那一支**逐字相同**——下面
      // `assert.notEqual` 就是它的守卫：改了库却没改这里，测试会当场喊「空转」而不是假绿。
      const next = lib.replace(
        `                if t in GLOBAL_TAKES_ARG and j + 1 < n:
                    # \`-c k=v\` / \`--config-env k=ENVVAR\` 的**值**就是配置本身，别再丢掉。
                    if t in ("-c", "--config-env"):
                        configs.append(tokens[j + 1])
                    j += 2; continue
`,
        '',
      )
      assert.notEqual(next, lib, '替换必须真的命中，否则这条测试是空转')
      return next
    },
  })
  const problems = checkHookBehavior(dir, { only: ['push-commands', 'secret-guard'] })
  // 关键：同一处退化必须在**两个闸门**都报出来——这就是「共用一份理解」的可证伪形式。
  // 2026-09-02 的教训正是：两份各自的正则让同一个洞要在两处分别被发现、分别被修。
  assert.ok(
    problems.some((p) => p.includes('命令识别漏判') && p.includes('git -c')),
    'push 闸应报 `git -c k=v push --no-verify` 的绕口没记下来',
  )
  assert.ok(
    problems.some((p) => p.includes('secret-guard 漏判') && p.includes('git -c')),
    'secret-guard 应同时报 `git -c k=v commit --no-verify` 被漏判',
  )
})

test('push 闸推荐了不存在的脚本 → 门岗报红', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) => replaceOnce(hook, 'node ./scripts/check-push-bypass.mjs', 'node ./scripts/check-push-bypass-typo.mjs'),
  })
  const problems = checkHookBehavior(dir, { only: ['suggestion'] })
  assert.ok(
    problems.some((p) => p.includes('check-push-bypass-typo.mjs') && p.includes('不存在')),
    '应指出 hook 让人运行一个不存在的脚本',
  )
})

// —— 轴 C：登记表里的命令在「脚本被挪走」时的行为（2026-09-07）——
//
// 报告到的那一例是「落后的 worktree 上 commit-bypass-check.sh 不存在」，但真正的类是
// **防线依赖一个可能不存在的文件，缺失时默认放行**。缺失的成因换了好几茬（没跑 pnpm install、
// 分支停在旧提交、文件被删），「缺失 = 127 = 放行」这一条一次都没被拦过。

/** 造一棵只有 hook 契约面的假项目根：脚本齐、settings 可按需改写。 */
function makeSettingsFixture(t, rewriteCommand) {
  const dir = makeTempDir('nomi-hook-settings-')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'scripts', 'claude-hooks'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
  for (const name of fs.readdirSync(path.join(repoRoot, 'scripts/claude-hooks'))) {
    if (!name.endsWith('.sh')) continue
    fs.copyFileSync(path.join(repoRoot, 'scripts/claude-hooks', name), path.join(dir, 'scripts/claude-hooks', name))
  }
  const settings = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude/settings.json'), 'utf8'))
  if (rewriteCommand) {
    for (const groups of Object.values(settings.hooks)) {
      for (const group of groups) for (const hook of group.hooks) hook.command = rewriteCommand(hook.command)
    }
  }
  fs.writeFileSync(path.join(dir, '.claude/settings.json'), JSON.stringify(settings, null, 2))
  return dir
}

test('登记表退回裸 `bash <脚本>` → 三个拦截型闸门全部报「缺失时 127 不是 2」（今天实测的那一例）', (t) => {
  const dir = makeSettingsFixture(t, (command) => {
    const script = /CLAUDE_PROJECT_DIR\/([\w./-]+\.sh)/.exec(command)[1]
    return `bash "$CLAUDE_PROJECT_DIR/${script}"`
  })
  const problems = checkHookBehavior(dir, { only: ['settings-guard'] })
  for (const script of ['pre-push-check.sh', 'commit-bypass-check.sh', 'secret-guard.sh']) {
    assert.ok(
      problems.some((p) => p.includes(script) && p.includes('退出码是 127')),
      `${script} 的缺失行为必须被拦下——裸 bash 缺文件退 127，Claude Code 当「继续」`,
    )
  }
})

test('把拦截型守卫的退出码从 2 改成 1 → 报红（1 是非阻断错误，不拦人）', (t) => {
  const dir = makeSettingsFixture(t, (command) => command.replace('exit 2;', 'exit 1;'))
  const problems = checkHookBehavior(dir, { only: ['settings-guard'] })
  assert.ok(
    problems.some((p) => p.includes('commit-bypass-check.sh') && p.includes('退出码是 1')),
    '退出码不是 2 就不是阻断，必须报红',
  )
})

test('提示型守卫被写成 exit 2 → 报红（Stop 上会锁成想修都停不下来的死循环）', (t) => {
  const dir = makeSettingsFixture(t, (command) =>
    command.includes('completion-check.sh') ? command.replace('exit 1;', 'exit 2;') : command,
  )
  const problems = checkHookBehavior(dir, { only: ['settings-guard'] })
  assert.ok(
    problems.some((p) => p.includes('completion-check.sh') && p.includes('不该把人锁死')),
    '提示型 hook 缺失时不该阻断',
  )
})

test('提示型守卫一声不吭地放行 → 报红（可以 fail-open，不可以 fail-silent）', (t) => {
  const dir = makeSettingsFixture(t, (command) =>
    command.includes('handoff-read.sh') ? `sh -c 'h="$CLAUDE_PROJECT_DIR/scripts/claude-hooks/handoff-read.sh"; [ -f "$h" ] || exit 0; exec bash "$h"'` : command,
  )
  const problems = checkHookBehavior(dir, { only: ['settings-guard'] })
  assert.ok(
    problems.some((p) => p.includes('handoff-read.sh') && p.includes('fail-silent')),
    '缺失却既不报错也不出声 = 和正常放行长得一模一样，必须报红',
  )
})

test('仓库当前的登记表：脚本挪走必拦、脚本在场必放行（不许假红）', (t) => {
  const dir = makeSettingsFixture(t)
  assert.deepEqual(
    checkHookBehavior(dir, { only: ['settings-guard'] }),
    [],
    '守卫不许退化成「拦一切」——会误报的闸门用不了几次就会被人绕过',
  )
})

test('run 45331233660: settings probe preserves a clean main even when its origin advances', (t) => {
  const dir = makeTempDir('nomi-hook-main-')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const seed = path.join(dir, 'seed')
  const origin = path.join(dir, 'origin.git')
  const checkout = path.join(dir, 'checkout')
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = (message) =>
    git(seed, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '-m', message)

  git(dir, 'init', '-q', '-b', 'main', seed)
  fs.mkdirSync(path.join(seed, '.claude'))
  fs.copyFileSync(path.join(repoRoot, '.claude/settings.json'), path.join(seed, '.claude/settings.json'))
  git(seed, 'add', '.claude/settings.json')
  commit('checked out by CI')
  git(dir, 'clone', '--bare', seed, origin)
  git(dir, 'clone', origin, checkout)
  const baseSha = git(checkout, 'rev-parse', 'HEAD')
  fs.writeFileSync(path.join(checkout, '.git/info/exclude'), 'scripts/\n')
  // Copies keep the real Node CLI entry points active, including through SessionStart.
  fs.cpSync(path.join(repoRoot, 'scripts'), path.join(checkout, 'scripts'), { recursive: true })

  fs.writeFileSync(path.join(seed, 'unexpected-new-file.ts'), 'export {}\n')
  git(seed, 'add', 'unexpected-new-file.ts')
  commit('merged after CI installed dependencies')
  git(origin, 'fetch', seed, 'main:main')
  const aheadSha = git(origin, 'rev-parse', 'main')
  assert.notEqual(baseSha, aheadSha)
  assert.equal(git(checkout, 'branch', '--show-current'), 'main')
  assert.equal(git(checkout, 'rev-parse', 'origin/main'), baseSha)

  const status = () => git(checkout, '-c', 'core.quotePath=false', 'status', '--porcelain=v1')
  assert.equal(status(), '')
  assert.deepEqual(checkHookBehavior(checkout, { only: ['settings-guard'] }), [])
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), baseSha, `must not fast-forward to ${aheadSha}`)
  assert.equal(status(), '')
})
