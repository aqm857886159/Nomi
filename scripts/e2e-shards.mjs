#!/usr/bin/env node
// E2E 分片计划的命令行入口。CI 的 `Plan shard` 步调用它，把本片要跑的单元写进 $GITHUB_OUTPUT；
// 本地 `--table` 打整张分配表（看均衡），`--manifest` 打平的「全部走查项」清单（改前改后 diff 为空 = 一条没少）。
//
//   node scripts/e2e-shards.mjs --shard 2/4 [--github-output]
//   node scripts/e2e-shards.mjs --table 4
//   node scripts/e2e-shards.mjs --manifest
import fs from 'node:fs'
import { assertPartition, listShardItems, parseShardArg } from './lib/e2eShardPlan.mjs'

const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]

if (args.includes('--manifest')) {
  const lines = listShardItems().map((item) => `${item.kind}\t${item.id}`).sort()
  console.log(lines.join('\n'))
} else if (args.includes('--table')) {
  const total = Number(value('--table'))
  const bins = assertPartition(total)
  bins.forEach((bin, index) => {
    console.log(`片 ${index + 1}/${total}  约 ${bin.seconds}s  单元 [${bin.units.join(', ')}]  普查 ${bin.census.length} 格`)
  })
} else if (args.includes('--shard')) {
  const { index, total } = parseShardArg(value('--shard'))
  const bin = assertPartition(total)[index - 1]
  console.log(`E2E 分片 ${index}/${total}：约 ${bin.seconds}s；单元 [${bin.units.join(', ')}]；普查 ${bin.census.length} 格`)
  if (args.includes('--github-output')) {
    const out = process.env.GITHUB_OUTPUT
    if (!out) throw new Error('--github-output 需要 GITHUB_OUTPUT')
    // 用 | 包住每个 id：workflow 里 contains(units, '|mcp-journey|') 不会被 journeys 之类的子串误命中。
    fs.appendFileSync(out, `units=|${bin.units.join('|')}|\n`)
  }
} else {
  console.error('用法：--shard i/n [--github-output] | --table n | --manifest')
  process.exit(2)
}
