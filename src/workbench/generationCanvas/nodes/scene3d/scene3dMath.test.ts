import { describe, it, expect } from "vitest";
import { cameraPoseSampleChanged, followOrbitPolarBounds, type CameraPoseSample } from "./scene3dMath";
import {
  FOLLOW_ORBIT_MAX_POLAR_ANGLE,
  FOLLOW_ORBIT_MIN_POLAR_ANGLE,
} from "./scene3dConstants";

const base: CameraPoseSample = {
  px: 1, py: 2, pz: 3,
  rx: 0.1, ry: 0.2, rz: 0.3,
  tx: 0, ty: 0, tz: 0,
};

describe("cameraPoseSampleChanged", () => {
  it("首帧（prev 为 null）一律视为变化，保证至少回灌一次初始位姿", () => {
    expect(cameraPoseSampleChanged(null, base)).toBe(true);
  });

  it("完全相同的两帧视为未变（相机静止 → 不回调，避免 60fps churn）", () => {
    expect(cameraPoseSampleChanged({ ...base }, { ...base })).toBe(false);
  });

  it("亚 epsilon 的浮点抖动视为未变", () => {
    const jittered: CameraPoseSample = { ...base, px: base.px + 0.00005, rz: base.rz - 0.00003 };
    expect(cameraPoseSampleChanged(base, jittered)).toBe(false);
  });

  it("任一位置分量超过 epsilon 即视为变化", () => {
    expect(cameraPoseSampleChanged(base, { ...base, px: base.px + 0.01 })).toBe(true);
    expect(cameraPoseSampleChanged(base, { ...base, py: base.py - 0.01 })).toBe(true);
    expect(cameraPoseSampleChanged(base, { ...base, pz: base.pz + 0.01 })).toBe(true);
  });

  it("任一旋转分量超过 epsilon 即视为变化", () => {
    expect(cameraPoseSampleChanged(base, { ...base, rx: base.rx + 0.01 })).toBe(true);
    expect(cameraPoseSampleChanged(base, { ...base, ry: base.ry + 0.01 })).toBe(true);
    expect(cameraPoseSampleChanged(base, { ...base, rz: base.rz + 0.01 })).toBe(true);
  });

  it("仅 edit 模式下的 controls target 变化（tx/ty/tz）也算变化", () => {
    expect(cameraPoseSampleChanged(base, { ...base, tx: 0.5 })).toBe(true);
    expect(cameraPoseSampleChanged(base, { ...base, ty: -0.5 })).toBe(true);
    expect(cameraPoseSampleChanged(base, { ...base, tz: 0.5 })).toBe(true);
  });

  it("epsilon 边界：恰等于阈值不算变化，严格大于才算（与 > 实现一致）", () => {
    const eps = 0.0001;
    expect(cameraPoseSampleChanged(base, { ...base, px: base.px + eps })).toBe(false);
    expect(cameraPoseSampleChanged(base, { ...base, px: base.px + eps * 2 })).toBe(true);
  });

  it("自定义 epsilon 生效", () => {
    expect(cameraPoseSampleChanged(base, { ...base, px: base.px + 0.05 }, 0.1)).toBe(false);
    expect(cameraPoseSampleChanged(base, { ...base, px: base.px + 0.2 }, 0.1)).toBe(true);
  });
});

describe("followOrbitPolarBounds", () => {
  it("非跟随态：返回 [0,π] = OrbitControls 默认无约束（退出操控自由 orbit 不变，零回归）", () => {
    const bounds = followOrbitPolarBounds(false);
    expect(bounds.min).toBe(0);
    expect(bounds.max).toBe(Math.PI);
  });

  it("跟随态：返回电影构图带，夹住竖向两极（不到正俯视/正仰视）", () => {
    const bounds = followOrbitPolarBounds(true);
    expect(bounds.min).toBe(FOLLOW_ORBIT_MIN_POLAR_ANGLE);
    expect(bounds.max).toBe(FOLLOW_ORBIT_MAX_POLAR_ANGLE);
  });

  it("跟随带严格收窄于默认 [0,π]：上界不到顶视(0)、下界不到底视(π)", () => {
    const bounds = followOrbitPolarBounds(true);
    expect(bounds.min).toBeGreaterThan(0);
    expect(bounds.max).toBeLessThan(Math.PI);
    expect(bounds.min).toBeLessThan(bounds.max);
  });

  it("构图带落在合理区间（中高俯角 ~ 近水平仰角），主体不会被顶出框", () => {
    const bounds = followOrbitPolarBounds(true);
    // min ≈ 26°(从竖直起算的俯角)：> 15°(不会接近鸟瞰)且 < 水平(π/2)
    expect(bounds.min).toBeGreaterThan(Math.PI * (15 / 180));
    expect(bounds.min).toBeLessThan(Math.PI / 2);
    // max ≈ 100°(略过水平的低角度)：≥ 水平(π/2) 留一点仰拍空间，但 < 110°(远不到贴地正仰视脚底)
    expect(bounds.max).toBeGreaterThanOrEqual(Math.PI / 2);
    expect(bounds.max).toBeLessThan(Math.PI * (110 / 180));
  });
});

describe("焦段 mm ↔ 竖直 FOV（35mm 全幅等效）", async () => {
  const { fovToFocalMm, focalMmToFov, FOCAL_MM_MIN, FOCAL_MM_MAX } = await import("./scene3dMath");

  it("往返一致：mm → fov → mm 回到原值", () => {
    for (const mm of [12, 24, 35, 50, 85, 135, 200]) {
      expect(fovToFocalMm(focalMmToFov(mm))).toBe(mm);
    }
  });

  it("标准焦段锚点：50mm ≈ 27°、35mm ≈ 38°、200mm ≈ 6.9°（竖直向，片高 24mm）", () => {
    expect(focalMmToFov(50)).toBeCloseTo(27, 0);
    expect(focalMmToFov(35)).toBeCloseTo(38, 0);
    expect(focalMmToFov(200)).toBeCloseTo(6.9, 1);
  });

  it("越界 clamp 到 12-200mm 滑杆域", () => {
    expect(fovToFocalMm(120)).toBe(FOCAL_MM_MIN);
    expect(fovToFocalMm(3)).toBe(FOCAL_MM_MAX);
    expect(focalMmToFov(999)).toBe(focalMmToFov(FOCAL_MM_MAX));
  });
});

// ——— 2026-07-22 审计 P0：导出产物零 editor-only 元素（结构保证） ———
import * as THREE from "three";
import { collectCaptureHiddenObjects, tagEditorOnlySubtree, captureDimensions } from "./scene3dMath";
import { SCENE3D_EDITOR_ONLY_FLAG, SCENE3D_GRID_FLAG } from "./scene3dConstants";

describe("collectCaptureHiddenObjects（captureScene 隐藏集单源）", () => {
  it("收齐 editor-only flag 对象；网格仅 hideGrid 时收（视口截图保网格的语义不变）", () => {
    const scene = new THREE.Scene();
    const keep = new THREE.Mesh();
    scene.add(keep);
    const gizmo = new THREE.Group();
    gizmo.userData[SCENE3D_EDITOR_ONLY_FLAG] = true;
    gizmo.add(new THREE.Mesh());
    scene.add(gizmo);
    const grid = new THREE.Group();
    grid.userData[SCENE3D_GRID_FLAG] = true;
    scene.add(grid);
    expect(collectCaptureHiddenObjects(scene, false)).toEqual([gizmo]);
    expect(collectCaptureHiddenObjects(scene, true)).toEqual([gizmo, grid]);
  });

  it("tagEditorOnlySubtree 整树打标：TransformControls 式库私有网格全部进隐藏集（蓝球/轴/白点不再烧进导出）", () => {
    const scene = new THREE.Scene();
    const controls = new THREE.Group();
    const inner = new THREE.Group();
    const handleMesh = new THREE.Mesh();
    inner.add(handleMesh);
    controls.add(inner);
    scene.add(controls);
    tagEditorOnlySubtree(controls);
    const hidden = collectCaptureHiddenObjects(scene, false);
    expect(hidden).toContain(controls);
    expect(hidden).toContain(inner);
    expect(hidden).toContain(handleMesh);
  });
});

describe("captureDimensions（首尾帧全分辨率 vs 参考视频 720p 封顶）", () => {
  it("still-frame 不套 cap：16:9 → 1920×1080（与相机截图同分辨率）", () => {
    expect(captureDimensions("16:9", "still-frame")).toEqual({ width: 1920, height: 1080 });
  });
  it("reference-video 封顶 720p：16:9 → 1280×720（Seedance 参考视频约束零回归）", () => {
    expect(captureDimensions("16:9", "reference-video")).toEqual({ width: 1280, height: 720 });
  });
});
