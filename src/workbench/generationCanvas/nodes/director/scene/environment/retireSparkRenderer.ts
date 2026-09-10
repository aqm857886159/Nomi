/**
 * [INPUT]: @sparkjsdev/spark 的 SparkRenderer 公开调度状态、排序 onDirty、LoD worker.exclusive
 * [OUTPUT]: retireSparkRenderer：关闭调度并等待异步读者结束后只 dispose 一次
 * [POS]: SparkHost 唯一卸载边界；适配 Spark 2.1 同步 dispose，保留原生帧调度与排序算法
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { SparkRenderer } from '@sparkjsdev/spark'

const retiring = new WeakMap<SparkRenderer, Promise<void>>()

export function retireSparkRenderer(spark: SparkRenderer): Promise<void> {
  const existing = retiring.get(spark)
  if (existing) return existing
  spark.autoUpdate = false
  spark.enableDriveLod = false
  spark.enableLodFetching = false
  clearTimeout(spark.updateTimeoutId)
  clearTimeout(spark.sortTimeoutId)
  spark.updateTimeoutId = -1
  spark.sortTimeoutId = -1
  spark.sortDirty = false
  spark.onDirty = undefined
  const sorted = new Promise<void>((resolve) => {
    if (!spark.sorting) { resolve(); return }
    // Spark sets sorting=false before setDirty. Re-arm if LoD signals first.
    spark.onDirty = () => {
      if (spark.sorting) { spark.dirty = false; return }
      spark.onDirty = undefined
      resolve()
    }
    spark.dirty = false
  })
  const lod = spark.lodWorker?.exclusive(async () => {})
  const done = Promise.all([sorted, lod]).then(() => { spark.dispose() })
  retiring.set(spark, done)
  return done
}
