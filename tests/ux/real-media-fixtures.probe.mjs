#!/usr/bin/env node
// 真实素材对账探针（R13「四件真实」第④件的 asset-conformance 腿，2026-09-14）。
//
// 它回答一个问题：**登记表里的 codec / 位深 / 分辨率 / 字节数，是实测的还是从文档抄的？**
// （同族教训：`docs/lessons/gate-assertions-must-not-copy-derived-values.md`——看到 `>= N` 先问 N 是抄谁的。）
//
// 缺素材时**非零退出并打印缺什么**，不 skip、不退回合成素材兜底。
// 跑法：export NOMI_REAL_MEDIA_DIR="/Users/aoqimin/Desktop/视频/" && node tests/ux/real-media-fixtures.probe.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'

function ffprobe(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,pix_fmt', '-of', 'json', file],
    { encoding: 'utf8' },
  )
  return JSON.parse(out).streams[0]
}

const { dir, assets } = requireRealMediaAssets([])
console.log(`真实素材目录：${dir}`)

const mismatches = []
for (const [id, asset] of assets) {
  if (asset.derived) {
    console.log(`· ${id}：派生素材，由用它的测试从 ${asset.derivedFrom.assetId} 抽帧到 tmp（${asset.derivedFrom.how}）`)
    continue
  }
  const stream = ffprobe(asset.file)
  const bytes = fs.statSync(asset.file).size
  const actual = {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    bitDepth: /10le|10be/.test(stream.pix_fmt ?? '') ? 10 : 8,
    bytes,
  }
  for (const [key, expected] of Object.entries(asset.spec)) {
    if (actual[key] === undefined) continue
    if (actual[key] !== expected) mismatches.push(`${id}.${key}：登记 ${expected}，实测 ${actual[key]}`)
  }
  console.log(`· ${id}：${actual.codec} ${actual.width}×${actual.height} ${actual.bitDepth}-bit ${actual.bytes} bytes`)
}

if (mismatches.length > 0) {
  console.error('\n✖ 登记表与实测对不上（登记的数字不许是从文档抄的）：')
  for (const m of mismatches) console.error(`  - ${m}`)
  process.exit(1)
}
console.log('✔ 登记表与 ffprobe 实测逐格一致')
