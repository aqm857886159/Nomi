/**
 * [INPUT]: 依赖 three、@sparkjsdev/spark 的 SplatMesh / dyno、../../model/splatReveal（效果 id / 时长 / 倍速 / 尾停）
 * [OUTPUT]: 对外提供 createSplatReveal(mesh, effect?) → SplatRevealController（tick / isActive / dispose / effect / shaderDuration）
 * [POS]: director/scene/environment 的泼溅显现着色器：5 段 GLSL（Magic / Spread / Unroll / Twister / Rain）装进 Spark 的
 *        dyno objectModifier，按帧推进 t；t 走完 + 尾停 1s 自动摘掉 modifier 恢复原样。参数与时长的纯数学住 model/splatReveal。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import { dyno, type SplatMesh } from '@sparkjsdev/spark'
import {
  pickRevealEffect,
  revealShaderDuration,
  SPLAT_REVEAL_EFFECT_ID,
  SPLAT_REVEAL_HOLD_SECONDS,
  SPLAT_REVEAL_SPEED,
  type SplatRevealEffect,
} from '../../model/splatReveal'

export type SplatRevealController = {
  effect: SplatRevealEffect
  shaderDuration: number
  tick: (deltaSeconds: number) => void
  isActive: () => boolean
  dispose: () => void
}

const GLSL_GLOBALS = `
  vec3 hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(vec3(p.x * p.y * p.z, p.x + p.y * p.z, p.x * p.y + p.z));
  }

  vec3 noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    vec3 n000 = hash(i + vec3(0,0,0));
    vec3 n100 = hash(i + vec3(1,0,0));
    vec3 n010 = hash(i + vec3(0,1,0));
    vec3 n110 = hash(i + vec3(1,1,0));
    vec3 n001 = hash(i + vec3(0,0,1));
    vec3 n101 = hash(i + vec3(1,0,1));
    vec3 n011 = hash(i + vec3(0,1,1));
    vec3 n111 = hash(i + vec3(1,1,1));

    vec3 x0 = mix(n000, n100, f.x);
    vec3 x1 = mix(n010, n110, f.x);
    vec3 x2 = mix(n001, n101, f.x);
    vec3 x3 = mix(n011, n111, f.x);

    vec3 y0 = mix(x0, x1, f.y);
    vec3 y1 = mix(x2, x3, f.y);

    return mix(y0, y1, f.z);
  }

  mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
  }

  vec4 twister(vec3 pos, vec3 scale, float t) {
    vec3 h = hash(pos);
    float s = smoothstep(0.0, 8.0, t * t * 0.1 - length(pos.xz) * 2.0 + 2.0);
    if (length(scale) < 0.05) pos.y = mix(-10.0, pos.y, pow(s, 2.0 * h.x));
    pos.xz = mix(pos.xz * 0.5, pos.xz, pow(s, 2.0 * h.x));
    float rotationTime = t * (1.0 - s) * 0.2;
    pos.xz *= rot(rotationTime + pos.y * 20.0 * (1.0 - s) * exp(-1.0 * length(pos.xz)));
    return vec4(pos, s * s * s * s);
  }

  vec4 rain(vec3 pos, vec3 scale, float t) {
    vec3 h = hash(pos);
    float s = pow(smoothstep(0.0, 5.0, t * t * 0.1 - length(pos.xz) * 2.0 + 1.0), 0.5 + h.x);
    float y = pos.y;
    pos.y = min(-10.0 + s * 15.0, pos.y);
    pos.xz = mix(pos.xz * 0.3, pos.xz, s);
    pos.xz *= rot(t * 0.3);
    return vec4(pos, smoothstep(-10.0, y, pos.y));
  }
`

// GLSL 只写 ASCII 注释：着色器字符串会被 i18n 可见文字门岗当成界面文案扫（中文注释触发误报）
function statementsFor(names: { inGsplat: string; outGsplat: string; t: string; effectType: string; maxRadius: string }): string {
  const { inGsplat, outGsplat, t, effectType, maxRadius } = names
  return `
    ${outGsplat} = ${inGsplat};
    float t = ${t};
    vec3 scales = ${inGsplat}.scales;
    vec3 localPos = ${inGsplat}.center;
    float l = length(localPos.xz);

    if (${effectType} == 1) {
      // Magic: radial sweep cap scales with the scene radius (stock cap of 10 never reaches the rim of a large scene)
      float magicMaxS = max(${maxRadius} + 2.0, 10.0);
      float s = smoothstep(0.0, 10.0, t - 4.5) * magicMaxS;
      float border = abs(s - l - 0.5);
      localPos *= 1.0 - 0.2 * exp(-20.0 * border);
      vec3 finalScales = mix(scales, vec3(0.002), smoothstep(s - 0.5, s, l + 0.5));
      ${outGsplat}.center = localPos + 0.1 * noise(localPos.xyz * 2.0 + t * 0.5) * smoothstep(s - 0.5, s, l + 0.5);
      ${outGsplat}.scales = finalScales;
      float at = atan(localPos.x, localPos.z) / 3.1416;
      ${outGsplat}.rgba *= step(at, t - 3.1416);
      ${outGsplat}.rgba += exp(-20.0 * border) + exp(-50.0 * abs(t - at - 3.1416)) * 0.5;

    } else if (${effectType} == 2) {
      float tt = t * t * 0.4 + 0.5;
      localPos.xz *= min(1.0, 0.3 + max(0.0, tt * 0.05));
      ${outGsplat}.center = localPos;
      ${outGsplat}.scales = max(
        mix(vec3(0.0), scales, min(tt - 7.0 - l * 2.5, 1.0)),
        mix(vec3(0.0), scales * 0.2, min(tt - 1.0 - l * 2.0, 1.0))
      );
      ${outGsplat}.rgba = mix(vec4(0.3), ${inGsplat}.rgba, clamp(tt - l * 2.5 - 3.0, 0.0, 1.0));

    } else if (${effectType} == 3) {
      localPos.xz *= rot((localPos.y * 50.0 - 20.0) * exp(-t));
      ${outGsplat}.center = localPos * (1.0 - exp(-t) * 2.0);
      ${outGsplat}.scales = mix(vec3(0.002), scales, smoothstep(0.3, 0.7, t + localPos.y - 2.0));
      ${outGsplat}.rgba = ${inGsplat}.rgba * step(0.0, t * 0.5 + localPos.y - 0.5);

    } else if (${effectType} == 4) {
      vec4 effectResult = twister(localPos, scales, t);
      ${outGsplat}.center = effectResult.xyz;
      ${outGsplat}.scales = mix(vec3(0.002), scales, pow(effectResult.w, 12.0));
      float tw = effectResult.w;
      float spin = -t * 0.3 * (1.0 - tw);
      vec4 spinQ = vec4(0.0, sin(spin * 0.5), 0.0, cos(spin * 0.5));
      ${outGsplat}.quaternion = quatQuat(spinQ, ${inGsplat}.quaternion);

    } else if (${effectType} == 5) {
      vec4 effectResult = rain(localPos, scales, t);
      ${outGsplat}.center = effectResult.xyz;
      ${outGsplat}.scales = mix(vec3(0.005), scales, pow(effectResult.w, 30.0));
      float spin = -t * 0.3;
      vec4 spinQ = vec4(0.0, sin(spin * 0.5), 0.0, cos(spin * 0.5));
      ${outGsplat}.quaternion = quatQuat(spinQ, ${inGsplat}.quaternion);
    }
  `
}

export function createSplatReveal(mesh: SplatMesh, effect: SplatRevealEffect = pickRevealEffect()): SplatRevealController {
  const box = mesh.getBoundingBox(true)
  const size = box.getSize(new THREE.Vector3())
  const bounds = { maxRadiusXZ: Math.hypot(size.x / 2, size.z / 2), minY: box.min.y }
  const shaderDuration = revealShaderDuration(effect, bounds)
  const time = dyno.dynoFloat(0)
  const effectId = dyno.dynoInt(SPLAT_REVEAL_EFFECT_ID[effect])
  const maxRadius = dyno.dynoFloat(bounds.maxRadiusXZ)

  mesh.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    if (!gsplat) return { gsplat }
    const node = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, t: 'float', effectType: 'int', maxRadius: 'float' },
      outTypes: { gsplat: dyno.Gsplat },
      globals: () => [dyno.unindent(GLSL_GLOBALS)],
      statements: ({ inputs, outputs }) =>
        dyno.unindentLines(
          statementsFor({ inGsplat: inputs.gsplat ?? '', outGsplat: outputs.gsplat ?? '', t: inputs.t ?? '', effectType: inputs.effectType ?? '', maxRadius: inputs.maxRadius ?? '' }),
        ),
    })
    return { gsplat: node.apply({ gsplat, t: time, effectType: effectId, maxRadius }).gsplat }
  })
  mesh.updateGenerator()

  const totalSeconds = shaderDuration + SPLAT_REVEAL_HOLD_SECONDS
  let elapsed = 0
  let active = true
  const finish = () => {
    active = false
    mesh.objectModifier = undefined
    mesh.updateGenerator()
  }
  return {
    effect,
    shaderDuration,
    tick: (deltaSeconds) => {
      if (!active) return
      elapsed += deltaSeconds * SPLAT_REVEAL_SPEED
      time.value = elapsed
      mesh.updateVersion()
      if (elapsed >= totalSeconds) finish()
    },
    isActive: () => active,
    dispose: () => {
      if (active) finish()
    },
  }
}
