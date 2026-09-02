#!/usr/bin/env node
// 把版本化的 Claude harness hook 装进 `.claude/`（postinstall 自动跑，与 install-git-hooks.cjs 同一套路）。
//
// 为什么要有这个:`.gitignore` 里有 `.claude/`,所以那些 hook **不在 git 里**——
// 而 R11(push 五门闸)、R25(提交前 Ponytail 评审)、self-check(每轮三闸注入)全都靠它们兜底。
// 结果是:项目把它们当真闸门依赖,它们却无法评审、无法传播、跨 worktree 静默漂移。
// 这台机器常有 20+ 棵 worktree,新开一棵就是**裸奔**(压根没有 .claude/hooks/)。
// 2026-09-02 实测代价:pre-push 闸有个多 worktree 盲区(拿 A 树的戳记评判 B 树的推送,
// 既会误杀也会**误放**),修好却没法 PR、也传不到别的 worktree。
//
// 形状:`scripts/claude-hooks/` 是唯一真相源(进 git、可评审),这里负责装到 `.claude/hooks/`;
// 漂移由 `pnpm run check:claude-hooks` 拦(装的与仓里的不一致 → 红,逼你把改动提交回来)。
//
// 只碰 hook 脚本与 settings.json 的 `hooks` 块;`env`/`permissions` 是**机器本地**配置,原样保留。
// `.claude/hooks/violations.log`(踩坑流水)同样是本地数据,不进仓、不覆盖。

const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(repoRoot, 'scripts', 'claude-hooks')
const targetDir = path.join(repoRoot, '.claude', 'hooks')
const settingsPath = path.join(repoRoot, '.claude', 'settings.json')
const settingsSource = path.join(sourceDir, 'settings.hooks.json')

/** 版本化的 hook 脚本(settings.hooks.json 不是脚本,单独处理)。 */
function hookScripts() {
  if (!fs.existsSync(sourceDir)) return []
  return fs.readdirSync(sourceDir).filter((name) => name.endsWith('.sh')).sort()
}

function installScripts() {
  fs.mkdirSync(targetDir, { recursive: true })
  const changed = []
  for (const name of hookScripts()) {
    const from = path.join(sourceDir, name)
    const to = path.join(targetDir, name)
    const next = fs.readFileSync(from)
    const current = fs.existsSync(to) ? fs.readFileSync(to) : null
    if (current && current.equals(next)) continue
    fs.writeFileSync(to, next)
    fs.chmodSync(to, 0o755)
    changed.push(name)
  }
  return changed
}

/**
 * 只合并 `hooks` 一个键。settings.json 里的 env/permissions 是机器本地的,
 * 整份覆盖会把别人的授权配置洗掉——那属于「装个 hook 顺手改了你的权限」,不能干。
 */
function installSettings() {
  if (!fs.existsSync(settingsSource)) return false
  const desired = JSON.parse(fs.readFileSync(settingsSource, 'utf8')).hooks
  let settings = {}
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    } catch {
      // 手写坏了的 settings.json 不该让 install 整个失败;保留原文件,只报不改。
      console.warn('[claude-hooks] .claude/settings.json 解析失败,跳过 hooks 块合并(请手动修)')
      return false
    }
  }
  if (JSON.stringify(settings.hooks) === JSON.stringify(desired)) return false
  settings.hooks = desired
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  return true
}

/** --check:只报漂移、不写盘,给门岗用。 */
function check() {
  const problems = []
  for (const name of hookScripts()) {
    const to = path.join(targetDir, name)
    if (!fs.existsSync(to)) {
      problems.push(`缺失: .claude/hooks/${name}（跑 pnpm install 或 node scripts/install-claude-hooks.cjs）`)
      continue
    }
    if (!fs.readFileSync(to).equals(fs.readFileSync(path.join(sourceDir, name)))) {
      problems.push(`漂移: .claude/hooks/${name} 与 scripts/claude-hooks/${name} 不一致`)
    }
  }
  if (fs.existsSync(settingsSource) && fs.existsSync(settingsPath)) {
    try {
      const desired = JSON.parse(fs.readFileSync(settingsSource, 'utf8')).hooks
      const actual = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).hooks
      if (JSON.stringify(actual) !== JSON.stringify(desired)) {
        problems.push('漂移: .claude/settings.json 的 hooks 块与 scripts/claude-hooks/settings.hooks.json 不一致')
      }
    } catch {
      problems.push('无法解析 .claude/settings.json,hooks 块无法比对')
    }
  }
  return problems
}

const isCheck = process.argv.includes('--check')
if (isCheck) {
  const problems = check()
  if (problems.length === 0) {
    console.log(`✓ Claude hooks 门岗通过：${hookScripts().length} 个脚本与 hooks 块均与仓库一致。`)
    process.exit(0)
  }
  console.error('✖ Claude hooks 与仓库不一致（它们是 R11/R25/self-check 的执行体，漂了就等于闸门失真）:')
  for (const line of problems) console.error(`  - ${line}`)
  console.error('\n  → 本地改过 hook？把改动同步回 scripts/claude-hooks/ 并提交（这正是纳入版本库的意义：可评审、可传播）。')
  console.error('  → 只是没装/装旧了？`node scripts/install-claude-hooks.cjs`。')
  process.exit(1)
}

const changed = installScripts()
const settingsChanged = installSettings()
if (changed.length > 0) console.log(`Installed Claude hooks → .claude/hooks/ (${changed.join(', ')})`)
if (settingsChanged) console.log('Updated .claude/settings.json hooks block')
if (changed.length === 0 && !settingsChanged) console.log('Claude hooks already up to date')
