/**
 * [INPUT]: 依赖 node:fs、three、three/examples/jsm/loaders/GLTFLoader、src/assets/director/ual/ual-mannequin.glb（真资产，不 mock）
 * [OUTPUT]: 对外提供 loadUalMannequinForTest（仅测试用：node 里真加载默认人偶 glb，返回 three 的 GLTF）
 * [POS]: director/scene/character 的测试夹具：骨名去点、骨轴修正、动作采样这些断言都要对着真 glb 跑，绕开真资产的测试不算证据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs'
import path from 'node:path'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const UAL_GLB = path.resolve(__dirname, '../../../../../../assets/director/ual/ual-mannequin.glb')

let cached: Promise<ArrayBuffer> | null = null

/** 每次返回一份新解析的 GLTF（骨架可放心改）；文件字节只读一次 */
export async function loadUalMannequinForTest(): Promise<GLTF> {
  cached ??= fs.promises.readFile(UAL_GLB).then((bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  const buffer = await cached
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject))
}
