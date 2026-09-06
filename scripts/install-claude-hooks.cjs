#!/usr/bin/env node
// Claude harness hook 的**注册校验器**（2026-09-07 起；此前是安装器）。
//
// 变了什么、为什么变（P1：加新必删旧，R28：防线建在最早能拦住的那层）：
//   旧形状是「`scripts/claude-hooks/` 是真相源 → postinstall 把它们拷进 gitignore 的 `.claude/hooks/`」。
//   这形状有一个致命前提：**必须有人跑过 `pnpm install`**。而这台机器常有 20+ 棵 worktree，
//   docs-only 的会话为省时间根本不装依赖——于是那棵树上一个 PreToolUse 拦截都没有：
//   `git commit --no-verify`、`git -c core.hooksPath=…`、敏感数据扫描，全部静默失效，
//   而且**和正常放行长得一模一样**（这正是 2026-09-03 push-bypass 那份合同记的同一族风险）。
//   一道「装了才有」的闸门不是闸门，是运气。
//
//   新形状：`.claude/settings.json` 本身进 git（`.gitignore` 里对它开了口子），hook 命令
//   直接指向仓库内的 `scripts/claude-hooks/*.sh`。**随 checkout 就存在，不装依赖也在。**
//   这是 Claude Code 官方约定的用法：Shared project settings = `.claude/settings.json`，
//   「In a git repository, commit it so teammates get it」；个人设置走 `.claude/settings.local.json`
//   （https://code.claude.com/docs/en/settings）。我们此前没用它，才需要自己写一个安装器。
//
// 于是本文件只剩三件事：
//   ① 校验注册表：`.claude/settings.json` 里每条 hook 命令都指向仓库里真实存在的脚本；
//      `scripts/claude-hooks/` 下每个 *.sh 都被注册（下划线开头的是共用词法层，不单独注册）。
//      —— 这比旧的逐字节比对更强：它还拦得住「加了个 hook 脚本却忘了注册」。
//   ② 迁移：把历史遗留的机器本地键（env / permissions）挪进 `.claude/settings.local.json`，
//      并删掉 `.claude/hooks/` 下的旧安装副本（P1：不留并行版；留着只会让人改错那份）。
//   ③ `--check` 给门岗用：只报不改。
//
// 仍由 postinstall 调用（无害且幂等），但**不再是 hook 生效的前提**。
const fs = require('node:fs')
const path = require('node:path')
const { LOCAL_ONLY_KEYS, validateRegistration } = require('./claude-hooks-registry.cjs')

const repoRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(repoRoot, 'scripts', 'claude-hooks')
const settingsPath = path.join(repoRoot, '.claude', 'settings.json')
const localSettingsPath = path.join(repoRoot, '.claude', 'settings.local.json')
const legacyDir = path.join(repoRoot, '.claude', 'hooks')

/**
 * 不是 hook、因此不需要注册的脚本。**白名单必须写理由**——空口豁免就是下一次「写了不挂」的藏身处。
 * `_` 开头的一律当共用层（被别的 hook `source`），不单独注册。
 */
const NOT_A_HOOK = new Map([
  ['viol-add.sh', 'violations.log 的写入助手：由人 / reflect-and-propose 技能主动调用，不挂在任何事件上'],
])

/** 版本化的 hook 脚本（即「必须被注册」的那些）。 */
function hookScripts() {
  if (!fs.existsSync(sourceDir)) return []
  return fs.readdirSync(sourceDir)
    .filter((name) => name.endsWith('.sh') && !name.startsWith('_') && !NOT_A_HOOK.has(name))
    .sort()
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function legacyCopyCount() {
  if (!fs.existsSync(legacyDir)) return 0
  return fs.readdirSync(legacyDir).filter((name) => name.endsWith('.sh')).length
}

/** 仓库里真实存在的 hook 脚本（相对路径），喂给判据。 */
function existingScripts() {
  if (!fs.existsSync(sourceDir)) return []
  return fs.readdirSync(sourceDir).filter((name) => name.endsWith('.sh')).map((name) => `scripts/claude-hooks/${name}`)
}

/** 磁盘 → 判据（scripts/claude-hooks-registry.cjs）。判断本身不在这里，为的是能被 node-test 喂假树。 */
function validate() {
  let settings = null
  if (fs.existsSync(settingsPath)) {
    try {
      settings = readJson(settingsPath)
    } catch (error) {
      return [`.claude/settings.json 解析失败：${error.message}`]
    }
  }
  return validateRegistration({
    settings,
    requiredScripts: hookScripts(),
    existingScripts: existingScripts(),
    legacyCopies: legacyCopyCount(),
  })
}

/** 迁移：机器本地键挪进 settings.local.json，旧安装副本删掉。返回做过的事。 */
function migrate() {
  const done = []
  if (!fs.existsSync(settingsPath)) return done
  let settings
  try {
    settings = readJson(settingsPath)
  } catch {
    console.warn('[claude-hooks] .claude/settings.json 解析失败，跳过迁移（请手动修）')
    return done
  }
  const moved = {}
  for (const key of LOCAL_ONLY_KEYS) {
    if (settings[key] === undefined) continue
    moved[key] = settings[key]
    delete settings[key]
  }
  if (Object.keys(moved).length > 0) {
    let local = {}
    if (fs.existsSync(localSettingsPath)) {
      try {
        local = readJson(localSettingsPath)
      } catch {
        console.warn('[claude-hooks] .claude/settings.local.json 解析失败，本机键保留在原处不动')
        return done
      }
    }
    for (const [key, value] of Object.entries(moved)) {
      // 本机已有的同名键优先：迁移不该覆盖你自己后来改过的配置。
      if (local[key] === undefined) local[key] = value
    }
    fs.mkdirSync(path.dirname(localSettingsPath), { recursive: true })
    fs.writeFileSync(localSettingsPath, `${JSON.stringify(local, null, 2)}\n`)
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
    done.push(`本机键 ${Object.keys(moved).join(' / ')} → .claude/settings.local.json`)
  }
  if (fs.existsSync(legacyDir)) {
    const stale = fs.readdirSync(legacyDir).filter((name) => name.endsWith('.sh'))
    for (const name of stale) fs.rmSync(path.join(legacyDir, name))
    if (stale.length > 0) done.push(`删除 ${stale.length} 个 .claude/hooks/ 旧安装副本`)
  }
  return done
}

if (process.argv.includes('--check')) {
  const problems = validate()
  if (problems.length === 0) {
    console.log(`✓ Claude hooks 门岗通过：${hookScripts().length} 个脚本全部由版本化的 .claude/settings.json 注册，随 checkout 生效。`)
    process.exit(0)
  }
  console.error('✖ Claude hooks 注册不合法（它们是 R11/R25/self-check 的执行体，注册失真 = 闸门静默失效）:')
  for (const line of problems) console.error(`  - ${line}`)
  console.error('\n  → 改 hook 只改 scripts/claude-hooks/；新增脚本记得在 .claude/settings.json 里挂上。')
  console.error('  - 本机键跑错地方了？`node scripts/install-claude-hooks.cjs` 会把它迁进 settings.local.json。')
  process.exit(1)
}

const done = migrate()
for (const line of done) console.log(`[claude-hooks] ${line}`)
const problems = validate()
if (problems.length > 0) {
  console.warn('[claude-hooks] 注册有问题（跑 `pnpm run check:claude-hooks` 看详情）:')
  for (const line of problems) console.warn(`  - ${line}`)
} else if (done.length === 0) {
  console.log('Claude hooks 已随 checkout 生效（.claude/settings.json 直指 scripts/claude-hooks/），无需安装')
}
