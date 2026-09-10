/**
 * [INPUT]: 依赖 react、@react-three/fiber 的 useThree、@sparkjsdev/spark 的 SparkRenderer、./retireSparkRenderer
 * [OUTPUT]: 对外提供 SparkHost：把一个 SparkRenderer 挂到场景根，供所有 SplatMesh 共用（Spark 要求场景里有且一个）
 * [POS]: director/scene/environment 的泼溅渲染宿主（方案 §5.5）：只管生命周期（创建 / 卸载排空后 dispose），不碰任何泼溅对象；
 *        泼溅对象本身在 entities/SplatEntity 随图层变换挂载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useThree } from '@react-three/fiber'
import { SparkRenderer } from '@sparkjsdev/spark'
import { retireSparkRenderer } from './retireSparkRenderer'

export function SparkHost(): null {
  const { gl, scene } = useThree()
  React.useEffect(() => {
    const spark = new SparkRenderer({ renderer: gl })
    spark.name = 'directorSparkRenderer'
    scene.add(spark)
    return () => {
      scene.remove(spark)
      void retireSparkRenderer(spark)
    }
  }, [gl, scene])
  return null
}
