// 真集成测试：起真 MCP stdio 服务（app 自身二进制 + NOMI_MCP_STDIO=1，= Claude Code / Codex 拉起它的
// 真路径），像外部 agent 那样发 JSON-RPC，验真 skillStore 把仓内技能经 resources + prompts 真的
// list/read 出来。零生成额度（只读技能，不碰模型/项目）。
//
// 2026-09-02 重写（docs/fixes/2026-09-02-unwired-stale-skill-resource-test.root-cause.json）。修之前它有两个毛病：
//
// 1. **从没跑过。** 全仓只有它自己的头注释引用它——不在 package.json、不在 tests/system/profiles.mjs、
//    不在任何 workflow。于是它一边在文件里写着「验真 skillStore」，一边对任何回归零检出力；
//    而 `resources.length >= 20` 这种手抄下限连「有没有在跑」都掩盖了。现已挂进 test:mcp-journey，
//    与 MCP 面同触发面。
// 2. **断言已过期。** 它按面收敛前的形态写：期望裸 uri `nomi-skill://director-cinematography`
//    （现已内容寻址成 `nomi-skill://<dir>/<packageVersion>/<contentHash>`），且以未签名身份却期望拿到
//    内部创作技能（未签名 host 只能看 audience:"mcp" 的公开子集）。
//
// 现在：签名身份（local-authenticated → 全量目录），期望集合从**仓内 skills/ 目录 derive**，
// 不再手抄数量。签名客户端没有 audience 过滤，所以这里不存在「在测试里重抄一份可见性规则」的风险。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  assertBuilt,
  makeIsolatedDirs,
  repoRoot,
  spawnMcpStdioClient,
} from './_mcpJourney.mjs'

const SKILL_URI_PREFIX = 'nomi-skill://'
const UI_RESOURCE_URI = 'ui://nomi/live-draft.html'

/** 真相源：仓内 skills/ 下每个带 SKILL.md 的目录。签名客户端应当一个不少地拿到它们。 */
function bundledSkillDirectories() {
  const skillsDir = path.join(repoRoot, 'skills')
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort()
}

let passed = 0
function check(condition, label) {
  if (!condition) throw new Error(`MCP-SKILLS FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

async function main() {
  assertBuilt()
  const dirs = makeIsolatedDirs('nomi-mcp-skills-')
  // spawnMcpStdioClient 的基础 env 本身就带一份已验证的客户端身份（见 _mcpJourney.mjs 的
  // seedMcpClientIdentityEnv，默认 'claude'），因此这里**不再自己 seed 一遍**——重复注入等于并行版。
  // 签名身份 → mcpSkillAccess() 判为 local-authenticated → 拿到全量创作技能目录（无 audience 过滤，
  // 所以本测试不需要、也不应该在测试里重抄一份可见性规则）。
  const mcp = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: 'Nomi MCP skills integration', version: '1.0.0' },
    capabilities: {},
  })

  try {
    const init = await mcp.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'Nomi MCP skills integration', version: '1.0.0' },
    }, 30_000)
    check(Boolean(init.result), 'initialize 有响应（MCP stdio 服务起来了）')
    const caps = init.result.capabilities || {}
    check(Boolean(caps.tools && caps.resources && caps.prompts), '广告 tools + resources + prompts 能力')

    const resources = (await mcp.rpc('resources/list', {}, 30_000)).result?.resources || []
    const skillResources = resources.filter((resource) => String(resource.uri).startsWith(SKILL_URI_PREFIX))

    // 内容寻址后 uri 形如 nomi-skill://<dir>/<packageVersion>/<contentHash>，取首段即目录名。
    const listedDirectories = [...new Set(
      skillResources.map((resource) => String(resource.uri).slice(SKILL_URI_PREFIX.length).split('/')[0]),
    )].sort()
    const expectedDirectories = bundledSkillDirectories()
    assert.deepEqual(
      listedDirectories,
      expectedDirectories,
      `resources/list 的技能集合与仓内 skills/ 不一致：`
        + `多出 [${listedDirectories.filter((name) => !expectedDirectories.includes(name)).join(', ')}]，`
        + `缺少 [${expectedDirectories.filter((name) => !listedDirectories.includes(name)).join(', ')}]`,
    )
    check(true, `resources/list 恰好暴露仓内全部 ${expectedDirectories.length} 个技能（集合相等，非手抄下限）`)

    // 非技能资源只有 MCP Apps 的 widget 一条——显式钉住，免得「资源总数」将来又变成一个没人解释的数字。
    const otherResources = resources.filter((resource) => !String(resource.uri).startsWith(SKILL_URI_PREFIX))
    assert.deepEqual(otherResources.map((resource) => resource.uri), [UI_RESOURCE_URI],
      'resources/list 的非技能资源应当只有 live-draft widget')
    check(true, '非技能资源恰为 live-draft widget 一条')

    const cinematography = skillResources.find(
      (resource) => String(resource.uri).startsWith(`${SKILL_URI_PREFIX}director-cinematography/`),
    )
    check(Boolean(cinematography), '含 director-cinematography 资源（内容寻址 uri）')
    // name 从 2026-09-07 起就是目录名（Agent Skills 规范要求 name == 父目录名），所以这里
    // 按目录名断言而不是抄一个字面量——抄字面量正是上一次改名时这条断言变红的原因。
    check(
      cinematography.name === 'director-cinematography' && (cinematography.description || '').length > 5,
      '资源带 name（= 目录名）+ 非空 description',
    )
    // 渐进披露：list 只给索引，正文要另外 read。
    check(cinematography.text === undefined && cinematography.body === undefined, 'resources/list 不含正文（渐进披露）')

    const read = (await mcp.rpc('resources/read', { uri: cinematography.uri }, 30_000)).result
    const text = read?.contents?.[0]?.text || ''
    check(text.length > 1_000 && text.includes('镜头'), 'resources/read 按返回的 uri 载入真实技能正文')

    const prompts = (await mcp.rpc('prompts/list', {}, 30_000)).result
    const promptNames = (prompts?.prompts || []).map((prompt) => prompt.name)
    check(promptNames.includes('director-cinematography'), 'prompts/list 用 directoryName 当命令名（斜杠友好）')

    const badRead = await mcp.rpc('resources/read', { uri: `${SKILL_URI_PREFIX}nope-nonexistent` }, 30_000)
    check(Boolean(badRead.error), '未知技能资源回 error')

    console.log(`\nMCP-SKILLS-INTEGRATION PASS: ${passed} assertions（真 stdio 服务 · 真 skillStore · 零生成额度）`)
  } finally {
    await mcp.terminate()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
