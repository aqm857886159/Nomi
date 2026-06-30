// 画布左下角导航竖列（navigation-stack）：小地图 + 缩放条 + 显隐开关，从 GenerationCanvas 抽出
// 以守住外壳 ≤800 行（R9）。容器负责定位（absolute left-4 bottom-3），minimap 改 relative 靠它定位。
import React from "react";
import {
    IconEyeOff,
    IconFocusCentered,
    IconLayoutGrid,
    IconMap,
    IconRotate,
} from "@tabler/icons-react";
import { WorkbenchButton } from "../../../design";
import { cn } from "../../../utils/cn";
import { CanvasMinimap, MINIMAP_MIN_NODES } from "./CanvasMinimap";
import type { GenerationCanvasNode } from "../model/generationCanvasTypes";

type CanvasNavigationStackProps = {
    readOnly: boolean;
    nodes: GenerationCanvasNode[];
    selectedIds: Set<string>;
    zoom: number;
    zoomPercent: number;
    offset: { x: number; y: number };
    stageSize: { width: number; height: number };
    minimapVisible: boolean;
    onToggleMinimap: () => void;
    onJumpToCanvasPoint: (point: { x: number; y: number }) => void;
    onFitView: () => void;
    onResetView: () => void;
    onTidy: () => void;
    onZoomTo: (nextZoom: number) => void;
    batchPlanOverlay?: React.ReactNode;
};

export function CanvasNavigationStack({
    readOnly,
    nodes,
    selectedIds,
    zoom,
    zoomPercent,
    offset,
    stageSize,
    minimapVisible,
    onToggleMinimap,
    onJumpToCanvasPoint,
    onFitView,
    onResetView,
    onTidy,
    onZoomTo,
    batchPlanOverlay,
}: CanvasNavigationStackProps): JSX.Element {
    const hasMinimapContent = nodes.length >= MINIMAP_MIN_NODES;
    const showMinimap = minimapVisible && hasMinimapContent;
    const MinimapToggleIcon = showMinimap ? IconEyeOff : IconMap;

    return (
        <div
            className={cn(
                "generation-canvas-v2__navigation-stack",
                "absolute left-4 bottom-3 z-[8] flex flex-col items-start gap-2 pointer-events-none",
            )}
            aria-label="画布导航"
        >
            {showMinimap ? (
                <CanvasMinimap
                    nodes={nodes}
                    selectedIds={selectedIds}
                    zoom={zoom}
                    offset={offset}
                    stageSize={stageSize}
                    onJumpToCanvasPoint={onJumpToCanvasPoint}
                />
            ) : null}
            {batchPlanOverlay}
            <div
                className={cn(
                    "generation-canvas-v2__zoom-bar",
                    "inline-flex items-center gap-[2px] pointer-events-auto",
                    "min-h-9 p-1 border border-workbench-border rounded-nomi",
                    "bg-nomi-paper shadow-workbench-sm",
                )}
                aria-label="画布缩放"
            >
                <WorkbenchButton
                    aria-label="适应视图"
                    title={nodes.length === 0 ? "画布为空" : "适应视图"}
                    disabled={nodes.length === 0}
                    onClick={onFitView}
                >
                    <IconFocusCentered size={15} stroke={1.8} aria-hidden="true" />
                </WorkbenchButton>
                <WorkbenchButton aria-label="重置视图" title="重置视图" onClick={onResetView}>
                    <IconRotate size={15} stroke={1.8} aria-hidden="true" />
                </WorkbenchButton>
                <input
                    className="w-[78px] accent-workbench-accent"
                    type="range"
                    min="20"
                    max="300"
                    value={zoomPercent}
                    aria-label="缩放比例"
                    onChange={(event) => onZoomTo(Number(event.target.value) / 100)}
                />
                {!readOnly ? (
                    <WorkbenchButton
                        aria-label="整理画布"
                        title="整理画布（散乱时一键收纳 · ⌘Z 撤销）"
                        onClick={onTidy}
                    >
                        <IconLayoutGrid size={15} stroke={1.8} aria-hidden="true" />
                    </WorkbenchButton>
                ) : null}
                <WorkbenchButton
                    aria-label={showMinimap ? "隐藏小地图" : "显示小地图"}
                    title={
                        hasMinimapContent
                            ? showMinimap
                                ? "隐藏小地图"
                                : "显示小地图"
                            : `至少 ${MINIMAP_MIN_NODES} 个节点后显示小地图`
                    }
                    aria-pressed={showMinimap}
                    onClick={onToggleMinimap}
                >
                    <MinimapToggleIcon size={15} stroke={1.8} aria-hidden="true" />
                </WorkbenchButton>
            </div>
        </div>
    );
}
