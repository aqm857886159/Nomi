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

// —— 轴 C：doc-only 判据 vs 非 ASCII 路径（2026-09-07 论文雷达工人报到的那一例）——
//
// 报告到的形状：`docs/中文附件说明.md` 这类纯文档改动被 pre-push 闸判成「有代码改动」，
// 于是 docs-only 的推送白等一遍五门。根因是按行读了 `git diff --name-only`——
// git 默认 `core.quotePath=true`，非 ASCII 路径会被输出成 `"docs/\344\270\255…"`：
// 首尾各一个引号、中间八进制转义，闸门那把尺（`^docs/` / `\.md$`）两头都被引号挡掉。
//
// 下面两条是这一轴的阳性对照：把 hook 退回按行读 → 门岗必须报红（否则轴 C 是摆设），
// 等价改写（`-z` → `-c core.quotePath=false`）→ 必须照样绿（不许假红）。

test('doc-only 判据退回按行读 --name-only → 非 ASCII 路径被误判，门岗报红', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) => {
      // 精确还原修复前那一版：函数体按行 grep，调用点不带 -z。
      const next = hook
        .replace(
          /is_docs_only\(\) \{[\s\S]*?\n\}/,
          `is_docs_only() {\n  ARGV_LIST="$(cat)"\n  [ -n "$ARGV_LIST" ] || return 1\n  printf '%s\\n' "$ARGV_LIST" | grep -Ev '(\\.md$|\\.txt$|^docs/|^\\.claude/)' | grep -q . && return 1\n  return 0\n}`,
        )
        .replaceAll('git diff -z --name-only', 'git diff --name-only')
      assert.ok(next.includes("grep -Ev '(\\.md$"), '替换必须真的命中，否则这条测试是空转')
      assert.ok(!next.includes('git diff -z --name-only'), '调用点必须真的退回不带 -z，否则这条测试是空转')
      return next
    },
  })
  const problems = checkHookBehavior(dir, { only: ['docs-only'] })
  assert.ok(
    problems.some((p) => p.includes('doc-only 误判') && p.includes('非 ASCII')),
    `退回按行读之后，非 ASCII 文档名必须被门岗抓到误判；实际报出：${JSON.stringify(problems)}`,
  )
  // 反面对照同时必须还在：混了 .ts 的那条不许因为「放宽」而漏判。
  assert.ok(!problems.some((p) => p.includes('doc-only 漏判')), '按行读只会误判，不该同时出现漏判')
})

test('doc-only 判据换成 -c core.quotePath=false（等价写法）→ 必须照样绿', (t) => {
  const dir = makeContractFixture(t, {
    mutateHook: (hook) => {
      const next = hook.replaceAll('git diff -z --name-only', 'git -c core.quotePath=false diff --name-only')
      assert.notEqual(next, hook, '替换必须真的命中，否则这条测试是空转')
      // 函数体还是按 NUL 读，所以这里得把分隔符补回去——等价性验的是「路径不再被转义」这件事。
      return next.replaceAll('git -c core.quotePath=false diff --name-only', 'git -c core.quotePath=false diff --name-only -z')
    },
  })
  assert.deepEqual(
    checkHookBehavior(dir, { only: ['docs-only'] }),
    [],
    '关掉 quotePath 的等价写法必须被接受——会误报的门岗三次之后就会被人绕过',
  )
})
