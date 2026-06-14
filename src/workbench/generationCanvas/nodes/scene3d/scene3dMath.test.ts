import { describe, it, expect } from "vitest";
import { cameraPoseSampleChanged, type CameraPoseSample } from "./scene3dMath";

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
