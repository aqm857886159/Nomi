#!/usr/bin/env node
// 症状聚类门岗（R21 / R14，2026-09-07）。判据住在 scripts/symptom-cluster-lib.mjs；
// 本文件只负责读盘、报红。
//
// 一句话：同一层 7 天里收到第三份根因合同 → 红，要求先出那一层的结构评审（docs/audit/*.md）。
// 根因流程是逐件执行的，「这周这个模块已经是第三次了」这个信号此前没有 owner——人不会去数。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SYMPTOM_CLUSTER_MIN_CONTRACTS,
  SYMPTOM_CLUSTER_THRESHOLD_DATE,
  SYMPTOM_CLUSTER_WINDOW_DAYS,
  contractDate,
  evaluateClusters,
  findClusters,
  modulesOf,
} from './symptom-cluster-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXES_DIR = path.join(repoRoot, 'docs', 'fixes')
const AUDIT_DIR = path.join(repoRoot, 'docs', 'audit')

function readContracts() {
  if (!fs.existsSync(FIXES_DIR)) return []
  return fs.readdirSync(FIXES_DIR)
    .filter((name) => name.endsWith('.root-cause.json'))
    .sort()
    .map((name) => {
      const file = `docs/fixes/${name}`
      let contract
      try {
        contract = JSON.parse(fs.readFileSync(path.join(FIXES_DIR, name), 'utf8'))
      } catch (error) {
        console.error(`✖ 无法解析根因合同 ${file}：${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
      return { file, date: contractDate(file), modules: modulesOf(contract) }
    })
}

function readAudits() {
  if (!fs.existsSync(AUDIT_DIR)) return []
  const audits = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) {
        audits.push({
          file: path.relative(repoRoot, full).split(path.sep).join('/'),
          date: contractDate(entry.name),
          text: fs.readFileSync(full, 'utf8'),
        })
      }
    }
  }
  walk(AUDIT_DIR)
  return audits
}

const contracts = readContracts()
const clusters = findClusters({ contracts })
const errors = evaluateClusters({ clusters, audits: readAudits() })

// 阈值之前的簇不追溯，但要说出来——静默豁免会让人以为「从来没聚过」。
const grandfathered = clusters.filter((cluster) => !cluster.contracts.every((entry) => entry.date >= SYMPTOM_CLUSTER_THRESHOLD_DATE))

if (errors.length > 0) {
  console.error(`✖ 症状聚类门岗失败（同一模块 ${SYMPTOM_CLUSTER_WINDOW_DAYS} 天内 ≥${SYMPTOM_CLUSTER_MIN_CONTRACTS} 份根因合同）：`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(`✅ 症状聚类门岗：${contracts.length} 份合同，${clusters.length} 个聚簇`
  + `（${grandfathered.length} 个早于阈值 ${SYMPTOM_CLUSTER_THRESHOLD_DATE} 不追溯），无未评审的高频模块`)
