// 五门戳契约的类级回归测试（2026-09-02）。
//
// 报告到的那一例是「gates 写 .claude/.gates-ok、hook 读 <gitdir>/nomi-gates-ok」，
// 但真正的类是**写戳方与读戳方各自演进、没有任何东西强迫它们一致**。
//
// 这里额外钉住门岗自己的两个方向（第一版两边都栽过，见 check-hook-behavior.mjs 的注释）：
//   · 不许假绿——把 hook 里可执行那行改回老戳、注释原样留着，必须报红；
//   · 不许假红——把 sed 换成等价的 awk，行为没变，必须照样绿。
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkHookBehavior } from './check-hook-behavior.mjs'
import {
  MARKER_BASENAME,
  STAMP_KEYED_FIELDS,
  collectStampFields,
  resolveMarkerPath,
  writeStamp,
} from './stamp-gates-ok.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK_REL = 'scripts/claude-hooks/pre-push-check.sh'
const GUARD_REL = 'scripts/claude-hooks/secret-guard.sh'
const LIB_REL = 'scripts/claude-hooks/_bash-command-analysis.sh'

/** 造一棵一次性 git 仓库，避免动到真仓库的戳。 */
function makeTempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-push-gate-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  run('init', '-q')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  run('add', '-A')
  run('commit', '-q', '--no-verify', '-m', 'init')
  return dir
}

/**
 * 复制一份仓库的契约面到临时目录，供「单边漂移」用例改写。
 * 注意 hook 必须是真文件——门岗会**实际执行**它。
 */
function makeContractFixture(t, { mutateHook, mutateLib } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-gates-contract-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'scripts', 'claude-hooks'), { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'scripts/stamp-gates-ok.mjs'), path.join(dir, 'scripts/stamp-gates-ok.mjs'))
  const hook = fs.readFileSync(path.join(repoRoot, HOOK_REL), 'utf8')
  fs.writeFileSync(path.join(dir, HOOK_REL), mutateHook ? mutateHook(hook) : hook)
  // 两个闸门共用的命令理解层：必须一起复制，否则 hook 会走「理解层缺失」的 fail 分支，
  // 测出来的红就不是我们想验的那个原因了。
  for (const rel of [LIB_REL, GUARD_REL]) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
    fs.writeFileSync(path.join(dir, rel), rel === LIB_REL && mutateLib ? mutateLib(src) : src)
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { gates: pkg.scripts.gates } }, null, 2))
  return dir
}

test('戳的内容由 STAMP_KEYED_FIELDS 逐项驱动，不是另一份硬编码模板', (t) => {
  const dir = makeTempRepo(t)
  const { marker } = writeStamp(dir)
  const written = fs
    .readFileSync(marker, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split('=')[0])
  // 声明的每个身份字段都必须真的写出去；stamped_at 是给人看的附加行。
  assert.deepEqual(
    written.filter((field) => field !== 'stamped_at'),
    [...STAMP_KEYED_FIELDS],
    '写出的身份字段必须与 STAMP_KEYED_FIELDS 逐项一致（此前 writeStamp 用的是硬编码模板，等于第二份真相源）',
  )

  const values = collectStampFields(dir)
  const body = fs.readFileSync(marker, 'utf8')
  for (const field of STAMP_KEYED_FIELDS) {
    assert.equal(body.match(new RegExp(`^${field}=(.*)$`, 'm'))[1], values[field])
  }
})

test('声明了字段却没有取值来源 → 直接抛错，不许写出空字段', (t) => {
  const dir = makeTempRepo(t)
  STAMP_KEYED_FIELDS.push('branch')
  try {
    assert.throws(() => collectStampFields(dir), /branch/)
  } finally {
    STAMP_KEYED_FIELDS.pop()
  }
})

test('戳落在本树自己的 gitdir 下（多 worktree 不互相顶用）', (t) => {
  const dir = makeTempRepo(t)
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir, encoding: 'utf8' }).trim()
  assert.equal(resolveMarkerPath(dir), path.join(gitDir, MARKER_BASENAME))
})

// 「真仓库当前状态是否合格」不在这里断言：`check:hook-behavior` 紧接着就会跑
// `node ./scripts/check-hook-behavior.mjs` 做同一件事，而且它的报错是逐条人话，
// 比这里 deepEqual 吐一个中文数组好读。重复跑一遍只是白花约 4 秒。

test('写戳方漂移（退回老的内联 .gates-ok）→ 门岗报红', (t) => {
  const dir = makeContractFixture(t)
  const pkgPath = path.join(dir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.scripts.gates = 'pnpm run gates:contracts && node -e "require(\'fs\').writeFileSync(\'.claude/.gates-ok\',\'x\')"'
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

  const problems = checkHookBehavior(dir, { only: ['writer'] })
  assert.ok(problems.some((p) => p.includes('没有调用 scripts/stamp-gates-ok.mjs')), '应指出 gates 不再调用唯一书写者')
  assert.ok(problems.some((p) => p.includes('.gates-ok')), '应指出老戳复活')
})

test('读戳方漂移：可执行那行改回老戳、注释原样保留 → 必须报红（门岗 v1 在这里假绿过）', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) => {
      const next = hook.replace('MARKER="$GITDIR/nomi-gates-ok"', 'MARKER="$ROOT/.claude/.gates-ok"')
      assert.notEqual(next, hook, '替换必须真的命中，否则这条测试是空转')
      // 注释里仍然留着 nomi-gates-ok / --absolute-git-dir——v1 的文本匹配正是被它骗过去的。
      assert.ok(next.includes(MARKER_BASENAME), '注释中应仍含旧字符串，才能复现 v1 的假绿条件')
      return next
    },
  })
  const problems = checkHookBehavior(dir, { only: ['stamp'] })
  assert.ok(problems.length > 0, '注释里有正确字符串不代表 hook 行为正确；必须实跑才拦得住')
  assert.ok(problems.some((p) => p.includes('不认')), '应指出读戳方不认书写者盖出的戳')
})

test('读戳方等价改写（sed → awk）行为不变 → 必须照样绿（不许假红）', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) => {
      const next = hook
        .replace(`STAMP_SHA="$(sed -n 's/^sha=//p' "$MARKER" | head -1)"`, `STAMP_SHA="$(awk -F= '/^sha=/{print $2; exit}' "$MARKER")"`)
        .replace(
          `STAMP_WT="$(sed -n 's/^worktree=//p' "$MARKER" | head -1)"`,
          `STAMP_WT="$(awk -F= '/^worktree=/{print $2; exit}' "$MARKER")"`,
        )
      assert.ok(next.includes('awk -F='), '替换必须真的命中，否则这条测试是空转')
      return next
    },
  })
  assert.deepEqual(
    checkHookBehavior(dir, { only: ['stamp'] }),
    [],
    '等价的 shell 写法必须被接受——会误报的门岗三次之后就会被人绕过（见 docs/design/page-design-process.md）',
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
    'pre-push 应报 `git -c k=v push` 被漏判',
  )
  assert.ok(
    problems.some((p) => p.includes('secret-guard 漏判') && p.includes('git -c')),
    'secret-guard 应同时报 `git -c k=v commit --no-verify` 被漏判',
  )
})

test('读戳方推荐了不存在的补盖脚本 → 门岗报红（报告到的那一例）', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) => {
      const next = hook.replace('node ./scripts/stamp-gates-ok.mjs', 'node ./scripts/stamp-gates-ok-typo.mjs')
      assert.notEqual(next, hook, '替换必须真的命中，否则这条测试是空转')
      return next
    },
  })
  const problems = checkHookBehavior(dir, { only: ['suggestion'] })
  assert.ok(
    problems.some((p) => p.includes('stamp-gates-ok-typo.mjs') && p.includes('不存在')),
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-hook-settings-'))
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
