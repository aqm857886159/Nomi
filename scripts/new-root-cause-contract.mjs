#!/usr/bin/env node
// 根因合同（schema v3）脚手架（2026-09-02）。治的是「对着 validator 报错逐轮试错拼合同」：
// v3 的必填面很宽（recurring 一档 20+ 字段、5 处枚举、若干「⊆ / 至少两条 / 至少一条 enforced」
// 约束），徒手起草一次要吃好几轮 check:root-cause-contracts 红。这里一次生成**逐字段对齐
// scripts/root-cause-contracts.mjs validator** 的骨架：每个占位值自带「怎么填 + 枚举全集」，
// 枚举位故意放非法的 `TODO(...)`——没填完的骨架必然红，不会带着 TODO 混过门。
//
// 用法：node scripts/new-root-cause-contract.mjs <id>      （或 pnpm run new:contract <id>）
//   → 生成 docs/fixes/<id>.root-cause.json（已存在则拒绝覆盖）
//
// 骨架默认按 recurring（复发类）给全字段——这是 P2「修根因配结构保证」的主路径；
// 真是 one_off 时按 recurrence.classification 占位里的说明降档（必须删掉 prevention）。
// 结构层的「填完即绿」由 scripts/new-root-cause-contract.node-test.mjs 钉死，
// 它随 check:root-cause-contracts 一起跑：validator 的必填面变了，这里跟不上会当场红。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT_CAUSE_CONTRACT_SCHEMA_VERSION } from './root-cause-contracts.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 生成 schema v3 骨架。每个 TODO 值就是该字段的行内填写说明；枚举位列出合法全集。 */
export function buildSkeleton(id, today = new Date().toISOString().slice(0, 10)) {
  return {
    schema_version: ROOT_CAUSE_CONTRACT_SCHEMA_VERSION,
    id,
    problem_type: 'TODO: 问题类型一句话，如「棘轮基线漂移」「IPC 未绑定来源」',
    symptom: 'TODO: 症状层——用户/CI 实际看到了什么',
    direct_cause: 'TODO: 直接原因——这一处为什么坏（file:line 级）',
    class_root: 'TODO: 类根因——哪种写法/结构让整类问题可能发生（P2 的「入口集」视角）',
    migration: 'TODO: 迁移——从旧状态到新状态怎么走，旧的删了没（P1）',
    affected_population: ['TODO: 谁/哪些路径/哪些场景受影响，至少一条'],
    scope_paths: ['TODO: 类问题的边界路径，须真实存在；目录写 dir/ 或 dir/**，且必须盖住 shared_boundaries'],
    entry_points: ['TODO: 这类 bug 的入口集（file:line 或符号），扫出来的不是猜的'],
    invariants: ['TODO: 修完后必须恒真的不变量'],
    regression_tests: ['TODO: 回归测试文件路径——必须是测试文件、真实存在、且在本次 diff 中有变化'],
    residual_risks: ['TODO: 修完仍残留的风险；确无则写「无——<理由>」'],
    external_sources: [],
    internal_only_reason:
      'TODO: 纯内部问题写清为何不需要外部依据；若查了官方文档/源码则删掉本字段，改填 external_sources: [{kind: official-doc|source-code, url: https://…, checked_at: YYYY-MM-DD（如 ' +
      today +
      '）, purpose: 查它证明了什么}]',
    recurrence: {
      classification:
        'TODO(one_off|recurring)——recurring 走下面全部类级字段；one_off 必须删掉 prevention（validator 禁止 one_off 带 prevention）',
      reason: 'TODO: 为什么判这一档（复发机制或孤例证明）',
      same_class_scan: ['TODO: 全仓实扫同类入口的证据（file:line），扫不是猜'],
    },
    generality_proof: 'TODO: 通用性论证——为什么修在下面的边界上，整类就不再复发（仅 recurring 必填）',
    shared_boundaries: [
      {
        path: 'TODO: 生产执行边界文件（须真实存在，且被 scope_paths 盖住）',
        symbol: 'TODO: 边界符号/函数名',
        responsibility: 'TODO: 这个边界负责拦住什么',
      },
    ],
    same_class_entry_points: [
      {
        path: 'TODO: 同类入口文件（须真实存在）',
        entry_point: 'TODO: 入口符号',
        disposition: 'TODO(enforced|not-affected)',
        evidence: 'TODO: 逐条独立核查的证据',
      },
      {
        path: 'TODO: 第二个同类入口——至少两条、path#entry_point 不得重复、整体至少一条 enforced',
        entry_point: 'TODO: 入口符号',
        disposition: 'TODO(enforced|not-affected)',
        evidence: 'TODO: 逐条独立核查的证据',
      },
    ],
    prevention: {
      kind: 'TODO(centralized-boundary|schema-validation|type-system|runtime-assertion|static-gate|migration|dependency-upgrade)',
      enforcement_path: 'TODO: 结构保证落点——必须 ∈ shared_boundaries.path、在本次 diff 中有变化、并出现在 artifacts 里',
      invariant: 'TODO: 该结构强制的不变量',
      failure_mode: 'TODO: 被违反时如何失败（谁报红、什么样子）',
      exception_policy: 'none',
      strategy: 'TODO: 防复发策略一句话',
      artifacts: ['TODO: 本次 diff 中变化的防复发工件——须含 enforcement_path，且至少一个非测试/非文档的结构件'],
    },
    class_regression_tests: ['TODO: 类级回归测试——必须 ⊆ regression_tests，且在本次 diff 中有变化'],
    legacy_paths: {
      status: 'TODO(removed|not-applicable)',
      removed_paths: [],
      rationale:
        'TODO: removed→在 removed_paths 列出同 diff 删掉的旧实现（P1 加新删旧）；not-applicable→说明为何无旧可删（removed_paths 必须留空）',
    },
    dependency_lifecycle: {
      decision: 'TODO(not-applicable|upgrade-now|retain-with-exit)',
      rationale:
        'TODO: 判断理由。not-applicable→保持没有 current/target 字段、exit_criteria 留空数组；upgrade-now/retain-with-exit→补 current 与 target 字符串，并给非空 exit_criteria',
      exit_criteria: [],
    },
  }
}

/** 把骨架写到 <dir>/<id>.root-cause.json；已存在则抛错（不覆盖任何已写的合同）。 */
export function writeSkeleton(id, dir = path.join(repoRoot, 'docs', 'fixes')) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(`非法 id「${id}」：只允许字母/数字/./_/-，如 2026-09-02-my-fix`)
  }
  const target = path.join(dir, `${id}.root-cause.json`)
  if (fs.existsSync(target)) {
    throw new Error(`已存在：${path.relative(repoRoot, target)}——不覆盖，换个 id 或直接编辑它`)
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(buildSkeleton(id), null, 2)}\n`)
  return target
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = process.argv[2]
  if (!id) {
    console.error('用法：node scripts/new-root-cause-contract.mjs <id>   （id 即文件名主干，如 2026-09-02-my-fix）')
    process.exit(1)
  }
  try {
    const target = writeSkeleton(id)
    console.log(`✅ 已生成 ${path.relative(repoRoot, target)}`)
    console.log('   → 逐个把 TODO 换成实情（每个 TODO 里写了怎么填；TODO(...) 括号里是枚举全集）')
    console.log('   → one_off 的话删掉 prevention；填完跑 pnpm run check:root-cause-contracts 验收')
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
