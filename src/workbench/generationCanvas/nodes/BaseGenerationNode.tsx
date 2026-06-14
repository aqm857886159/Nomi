import React from "react";
import {
    IconCopy,
    IconGripVertical,
    IconInfoCircle,
    IconLayoutGrid,
    IconMaximize,
    IconUpload,
} from "@tabler/icons-react";
import ProvenancePanel from "./ProvenancePanel";
import { getBuiltinCategoryById } from "../../project/projectCategories";
import CharacterCardNode from "./render/CharacterCardNode";
import TextDocumentNode from "./render/TextDocumentNode";
import SceneCardNode from "./render/SceneCardNode";
import PropCardNode from "./render/PropCardNode";
import AudioStripNode from "./render/AudioStripNode";
import ImageCropOverlay from "./render/ImageCropOverlay";
import NodeImageEditToolbar from "./NodeImageEditToolbar";
import NodeResultDownloadButton from "./NodeResultDownloadButton";
import { useNodeImageEditing } from "./useNodeImageEditing";
import { useNodeDragResize } from "./useNodeDragResize";
import { useHasFrameSourceEdge, useShotIndex } from "../hooks/useNodeRelationships";
import { lazyWithChunkBoundary } from "../../../ui/chunkBoundary";
import { GeneratingOverlay, PendingGenerationPlaceholder, Scene3DEditorLoading } from "./render/CardCommon";
import { cn } from "../../../utils/cn";
import { NomiImage } from "../../../design/media";
import { persistNodeImageFile } from "../adapters/persistNodeImage";
import type { GenerationCanvasNode } from "../model/generationCanvasTypes";
import { useWorkbenchStore } from "../../workbenchStore";
import { useGenerationCanvasStore } from "../store/generationCanvasStore";
import {
    encodeTimelineGenerationNodeDragPayload,
    TIMELINE_GENERATION_NODE_DRAG_MIME,
} from "../../timeline/timelineDragPayload";
import { getTrackTypeForClipType } from "../../timeline/timelineTypes";
import { buildClipFromGenerationNode } from "../model/buildClipFromGenerationNode";
import { toast } from "../../../ui/toast";
import { canRunGenerationNode, runGenerationNode } from "../runner/generationRunController";
import { NodeErrorReport } from "./NodeErrorReport";
import { WorkbenchButton } from "../../../design";
import NodeGenerationComposer from "./NodeGenerationComposer";
import { completeNodeConnection } from "./completeNodeConnection";
import { buildVideoPlaybackUrl } from "../../../media/videoPlaybackUrl";
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from "../../../media/videoPlaybackDiagnostics";
import PanoramaViewer, { type PanoramaScreenshot } from "./PanoramaViewer";
import { getGenerationNodeExecutionKind, isImageLikeGenerationNodeKind } from "../model/generationNodeKinds";
import { applyFixationMakeup } from "../fixation/buildFixationNode";
import { TechnicalReviewBadge } from "./TechnicalReviewBadge";
import {
    canDragGenerationNodeToTimeline,
    TIMELINE_DRAG_HANDLE_LABEL,
} from "../model/timelineDragAffordance";
import {
  STATUS_LABEL,
  RESIZE_DIRECTIONS,
  getNodeSizeBounds,
  FOCUS_GENERATION_NODE_EVENT,
  clampNumber,
  readFiniteNumber,
  mediaNodeSize,
  cardFixedSize,
  resolvePreviewHeight,
} from "./nodeSizing";

export type BaseGenerationNodeProps = {
    node: GenerationCanvasNode;
    selected: boolean;
    readOnly?: boolean;
    focusFlash?: boolean;
};
const Scene3DEditor = lazyWithChunkBoundary("3D 场景编辑器", () => import("./Scene3DEditor")); // A5：chunk 失败只降级本卡

function BaseGenerationNodeImpl({
    node,
    selected,
    readOnly = false,
    focusFlash = false,
}: BaseGenerationNodeProps): JSX.Element {
    const selectNode = useGenerationCanvasStore((state) => state.selectNode);
    const captureHistory = useGenerationCanvasStore(
        (state) => state.captureHistory,
    );
    const commitPersistedChange = useGenerationCanvasStore(
        (state) => state.commitPersistedChange,
    );
    const moveNode = useGenerationCanvasStore((state) => state.moveNode);
    const moveSelectedNodes = useGenerationCanvasStore(
        (state) => state.moveSelectedNodes,
    );
    // v0.7.2 perf: 订阅 boolean primitive 而不是整个 selectedNodeIds 数组
    // 之前数组引用每次变都触发所有节点 rerender；现在仅当 multi-select 状态翻转时触发
    const isMultiSelectActive = useGenerationCanvasStore(
        (state) => state.selectedNodeIds.length > 1,
    );
    // v0.7.2 perf: sourceNode 拆成两个 primitive 订阅，避免对象引用引发的伪 update
    const sourceNodeTitle = useGenerationCanvasStore((state) => {
        if (!node.derivedFrom) return undefined;
        return state.nodes.find(
            (candidate) => candidate.id === node.derivedFrom,
        )?.title;
    });
    const sourceNodeCategoryId = useGenerationCanvasStore((state) => {
        if (!node.derivedFrom) return undefined;
        return state.nodes.find(
            (candidate) => candidate.id === node.derivedFrom,
        )?.categoryId;
    });
    const sourceNodeExists = useGenerationCanvasStore((state) => {
        if (!node.derivedFrom) return false;
        return state.nodes.some(
            (candidate) => candidate.id === node.derivedFrom,
        );
    });
    const startConnection = useGenerationCanvasStore(
        (state) => state.startConnection,
    );
    const addNode = useGenerationCanvasStore((state) => state.addNode);
    const updateNode = useGenerationCanvasStore((state) => state.updateNode);
    const storeConnectNodes = useGenerationCanvasStore(
        (state) => state.connectNodes,
    );
    // v0.7.2 perf: 只关心 "this node 是否是 pending source"，boolean
    const isPendingConnectionSource = useGenerationCanvasStore(
        (state) => state.pendingConnectionSourceId === node.id,
    );
    const isPendingConnectionTarget = useGenerationCanvasStore(
        (state) =>
            state.pendingConnectionSourceId !== "" &&
            state.pendingConnectionSourceId !== node.id,
    );
    // perf：canvasZoom 仅事件处理器用、渲染从不读它；改按需 getState() 避免缩放时全节点重渲。
    const panoramaFullscreenRef = React.useRef<(() => void) | null>(null);
    const panoramaFourViewRef = React.useRef<(() => void) | null>(null);
    // E11: provenance viewer open state (mounted into node header for AI-generated assets)
    const [provenanceOpen, setProvenanceOpen] = React.useState(false);

    // C5: 自由缩放边界按 kind 取（text 比媒体节点更大）。在拖拽/缩放闭包之前算好，
    // 让 handlePointerMove 与渲染期的尺寸计算用同一份 bounds。
    const sizeBounds = getNodeSizeBounds(node.kind);

    const handleTimelineDragStart = (event: React.DragEvent<HTMLElement>) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(
            TIMELINE_GENERATION_NODE_DRAG_MIME,
            encodeTimelineGenerationNodeDragPayload(node),
        );
    };

    const handleAddToTimelineAtPlayhead = (
        event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        const timeline = useWorkbenchStore.getState().timeline;
        const startFrame = timeline.playheadFrame;
        const clip = buildClipFromGenerationNode(node, {
            fps: timeline.fps,
            startFrame,
        });
        if (!clip) {
            toast("该节点还没生成画面，先点「生成」", "info");
            return;
        }
        useWorkbenchStore
            .getState()
            .addTimelineClipAtFrame(
                clip,
                getTrackTypeForClipType(clip.type),
                startFrame,
            );
    };

    const updateMediaDimensions = (width: number, height: number) => {
        const nextSize = mediaNodeSize(width, height, node.size?.width);
        if (!nextSize) return;
        const meta = node.meta || {};
        const previousWidth = readFiniteNumber(
            meta.imageWidth ?? meta.videoWidth,
        );
        const previousHeight = readFiniteNumber(
            meta.imageHeight ?? meta.videoHeight,
        );
        const userResized = meta.userResized === true;
        const mediaPatch =
            node.result?.type === "video"
                ? {
                      videoWidth: width,
                      videoHeight: height,
                      videoAspectRatio: width / height,
                  }
                : {
                      imageWidth: width,
                      imageHeight: height,
                      imageAspectRatio: width / height,
                  };
        const shouldPatchSize =
            !userResized &&
            (node.size?.width !== nextSize.width ||
                node.size?.height !== nextSize.height);
        if (
            previousWidth === width &&
            previousHeight === height &&
            !shouldPatchSize
        )
            return;
        updateNode(node.id, {
            ...(shouldPatchSize
                ? { size: { width: nextSize.width, height: nextSize.height } }
                : {}),
            meta: {
                ...meta,
                ...mediaPatch,
                previewHeight: nextSize.previewHeight,
            },
        });
    };

    const handleFocusSourceNode = React.useCallback(
        (event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            if (!node.derivedFrom || typeof window === "undefined") return;
            window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: node.derivedFrom } }));
        },
        [node.derivedFrom],
    );

    const handlePanoramaFileChange = React.useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            const createdAt = Date.now();
            // 即时 base64 预览（短命）→ 落盘换 nomi-local 替换，避免全景大图 base64 永久驻留。
            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                const dataUrl = loadEvent.target?.result;
                if (typeof dataUrl !== "string") return;
                updateNode(node.id, { result: { id: `panorama-${createdAt}`, type: "image", url: dataUrl, createdAt } });
            };
            reader.readAsDataURL(file);
            void persistNodeImageFile(file, node.id).then((localUrl) => {
                if (!localUrl) return;
                updateNode(node.id, { result: { id: `panorama-asset-${createdAt}`, type: "image", url: localUrl, createdAt } });
            });
        },
        [node.id, updateNode],
    );

    const status = node.status || "idle";
    const size = node.size || { width: 320, height: 360 };
    // E.2.1: shots 分类的 composer 真正 flex-inlined（不再 absolute 浮在节点下方）
    // 配合 spec §6.1 修正 3：composer 内嵌到 card flex 流，与图像区共占节点视觉空间
    // [DESIGN-CARDS-07] renderKind 分发：非 shots 分类用专属 card 组件
    // renderKind 优先级：node.renderKind > 按 categoryId 推断
    // 素材节点：永远走纯图片预览。强制 renderKind=undefined，否则落进 cast/scene 分类的素材
    // 会被推断成角色卡/场景卡（A1.5 边界 1）。素材不挂 composer、不渲染生成占位。
    const isAssetKind = node.kind === "asset";
    const renderKind = isAssetKind
        ? undefined
        : ((node.renderKind as string | undefined) ??
          (node.categoryId === "cast"
              ? "character-card"
              : node.categoryId === "scene"
                ? "scene-card"
                : node.categoryId === "prop"
                  ? "prop-card"
                  : node.categoryId === "audio"
                    ? "audio-strip"
                    : undefined));
    const isCardKind = ["character-card", "scene-card", "prop-card", "audio-strip"].includes(renderKind as string);
    // C5: 文本节点走专属可编辑 body（TextDocumentNode），像 card 那样脱离图片预览。
    const isTextKind = node.kind === "text";
    const isImageGridSplitNode =
        node.kind === "image" &&
        typeof node.meta?.source === "string" &&
        node.meta.source.startsWith("image-grid-split-");
    const storedPreviewHeight =
        typeof node.meta?.previewHeight === "number" &&
        Number.isFinite(node.meta.previewHeight)
            ? isImageGridSplitNode
                ? Math.max(1, Math.round(node.meta.previewHeight))
                : clampNumber(
                      Math.round(node.meta.previewHeight),
                      sizeBounds.minHeight,
                      sizeBounds.maxHeight,
                  )
            : null;
    const hasResult = Boolean(node.result?.url);
    const { width: cardFixedWidth, height: cardFixedHeight } = cardFixedSize(
        renderKind,
        isCardKind,
    );
    const previewHeight = resolvePreviewHeight({
        node,
        hasResult,
        isCardKind,
        cardFixedWidth,
        cardFixedHeight,
        storedPreviewHeight,
        sizeWidth: size.width,
        sizeHeight: size.height,
        bounds: sizeBounds,
    });
    const visualSize = {
        width: cardFixedWidth ?? Math.max(sizeBounds.minWidth, size.width),
        height: previewHeight,
    };
    const { handlePointerDown, handlePointerMove, handlePointerUp, handleResizePointerDown } =
        useNodeDragResize({
            node,
            selected,
            readOnly,
            isMultiSelectActive,
            sizeBounds,
            visualSize,
            selectNode,
            captureHistory,
            moveNode,
            moveSelectedNodes,
            updateNode,
            commitPersistedChange,
        });
    const isGenerating = status === "queued" || status === "running";
    // v0.7.2 perf: 用 boolean primitive 订阅 canGenerate，而不是 getState() 同步读
    // 之前 getState() 在 render 外读，不响应 nodes/edges 变化，是个隐藏 bug
    const canGenerate =
        useGenerationCanvasStore((state) =>
            canRunGenerationNode(node, {
                nodes: state.nodes,
                edges: state.edges,
            }),
        ) && !isGenerating;
    const canSendToTimeline = canDragGenerationNodeToTimeline(node, {
        readOnly,
    });
    // 失败态不再显示文字徽标——错误信息已铺满节点正文（NodeErrorReport），
    // 顶部再写一遍「生成失败」是重复噪音（2026-06-03 6 角色评审）。
    const showStatusBadge =
        status === "queued" || status === "running";

    // v0.7.2 perf: 用 primitive 订阅 sourceNodeTitle / categoryId / exists 重组 label
    const sourceNodeLabel =
        sourceNodeTitle ||
        (node.derivedFrom && !sourceNodeExists
            ? "源节点已不在当前项目"
            : node.derivedFrom || "");
    const sourceCategoryName = sourceNodeCategoryId
        ? getBuiltinCategoryById(sourceNodeCategoryId)?.name
        : null;
    const independentCopyLabel =
        sourceCategoryName && sourceNodeExists
            ? `独立副本（来自 ${sourceCategoryName}·${sourceNodeLabel}）`
            : sourceNodeExists
              ? `独立副本（来自 ${sourceNodeLabel}）`
              : "独立副本（源节点已不存在）";
    const nodeExecutionKind = getGenerationNodeExecutionKind(node.kind);
    // L3：待生成卡给镜头序号，让未选中的占位卡也能一眼分清哪个镜头（非 shots 返回 null）。
    const shotIndex = useShotIndex(node.id, node.categoryId);
    const hasFrameSourceEdge = useHasFrameSourceEdge(node.id, nodeExecutionKind === "video"); // A15：已连上游边时占位不再喊「拖图」
    const needsFirstFrame = nodeExecutionKind === "video" && !canGenerate && !isGenerating;
    const handlePanoramaScreenshot = React.useCallback(
        (screenshot: PanoramaScreenshot) => {
            const { dataUrl, dimensions } = screenshot;
            const createdAt = Date.now();
            const screenshotNode = addNode({
                kind: "asset",
                title: screenshot.title || "全景截图",
                prompt: screenshot.prompt || "全景视口截图",
                position: {
                    x: Math.round(node.position.x + visualSize.width + 80),
                    y: Math.round(node.position.y),
                },
            });
            const result = {
                id: `panorama-shot-${screenshotNode.id}-${createdAt}`,
                type: "image" as const,
                url: dataUrl,
                createdAt,
            };
            const screenshotSize = mediaNodeSize(
                dimensions.width,
                dimensions.height,
            );
            updateNode(screenshotNode.id, {
                result,
                history: [result],
                status: "success",
                ...(screenshotSize
                    ? {
                          size: {
                              width: screenshotSize.width,
                              height: screenshotSize.height,
                          },
                      }
                    : {}),
                meta: {
                    ...(screenshotNode.meta || {}),
                    source: screenshot.source || "panorama-screenshot",
                    sourceNodeId: node.id,
                    localOnly: true,
                    imageWidth: dimensions.width,
                    imageHeight: dimensions.height,
                    imageAspectRatio:
                        dimensions.width / Math.max(1, dimensions.height),
                },
            });
            storeConnectNodes(node.id, screenshotNode.id, "reference");
        },
        [
            addNode,
            node.id,
            node.position.x,
            node.position.y,
            storeConnectNodes,
            updateNode,
            visualSize.width,
        ],
    );

    // 图片本地编辑（切图 / 裁剪 / 旋转翻转）—— A1.5 抽进 useNodeImageEditing。
    // 图片类与素材类共用；衍生物都「跳出新节点」，原图零改动。
    const imageEditing = useNodeImageEditing(node, visualSize);

    return (
        <article
            className={cn(
                "generation-canvas-v2-node",
                "absolute p-0 border-0 rounded-none bg-transparent shadow-none",
                "cursor-grab select-none touch-none overflow-visible",
                "data-[selected=true]:z-[5]",
                "block",
            )}
            data-node-id={node.id} data-kind={node.kind}
            data-expanded={selected ? "true" : "false"}
            data-selected={selected ? "true" : "false"}
            data-focus-flash={focusFlash ? "true" : "false"}
            data-status={status}
            style={{
                transform: `translate(${node.position.x}px, ${node.position.y}px)`,
                width: visualSize.width,
                height: visualSize.height,
                gridTemplateRows: `${previewHeight}px`,
                willChange: "transform",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}>
            {!readOnly ? (
                <>
                    <WorkbenchButton
                        className={cn(
                            "generation-canvas-v2-node__handle generation-canvas-v2-node__handle--input",
                            "absolute top-1/2 left-[-14px] inline-grid w-7 h-7 place-items-center p-0",
                            "border-0 rounded-full bg-transparent -translate-y-1/2 cursor-crosshair",
                            "opacity-80 transition-opacity duration-150 hover:opacity-100",
                            "data-[active=true]:opacity-100",
                        )}
                        aria-label='连接到此节点'
                        data-active={
                            isPendingConnectionTarget ? "true" : "false"
                        }
                        onPointerDown={(event) => {
                            event.stopPropagation();
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            completeNodeConnection(node.id);
                        }}>
                        <span
                            className='generation-canvas-v2-node__handle-dot'
                            aria-hidden='true'
                        />
                    </WorkbenchButton>
                    <WorkbenchButton
                        className={cn(
                            "generation-canvas-v2-node__handle generation-canvas-v2-node__handle--output",
                            "absolute top-1/2 right-[-14px] inline-grid w-7 h-7 place-items-center p-0",
                            "border-0 rounded-full bg-transparent -translate-y-1/2 cursor-crosshair",
                            "opacity-80 transition-opacity duration-150 hover:opacity-100",
                            "data-[active=true]:opacity-100",
                        )}
                        aria-label='从此节点开始连线'
                        data-active={
                            isPendingConnectionSource ? "true" : "false"
                        }
                        onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (
                                typeof event.currentTarget
                                    .releasePointerCapture === "function"
                            ) {
                                event.currentTarget.releasePointerCapture(
                                    event.pointerId,
                                );
                            }
                            startConnection(node.id);
                        }}>
                        <span
                            className='generation-canvas-v2-node__handle-dot'
                            aria-hidden='true'
                        />
                    </WorkbenchButton>
                </>
            ) : null}

            {node.kind === "panorama" &&
            selected &&
            !readOnly &&
            node.result?.url ? (
                <div
                    className={cn(
                        "generation-canvas-v2-node__panorama-toolbar",
                        "absolute left-1/2 bottom-[calc(100%+18px)] z-[12]",
                        "inline-flex items-center gap-1 min-h-[44px] py-[5px] px-2",
                        "border border-[rgba(18,24,38,0.08)] rounded-[14px]",
                        "bg-white/[0.96] shadow-[0_12px_34px_rgba(18,24,38,0.14)]",
                        "-translate-x-1/2 backdrop-blur-[12px]",
                    )}
                    role='toolbar'
                    aria-label='全景图操作'
                    onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        className={cn(
                            "inline-flex items-center justify-center gap-[7px]",
                            "min-w-0 min-h-[34px] px-[11px] border-0 rounded-[9px]",
                            "bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none whitespace-nowrap cursor-pointer",
                            "hover:bg-nomi-ink-05 hover:text-nomi-ink",
                        )}
                        type='button'
                        onClick={() => panoramaFullscreenRef.current?.()}>
                        <IconMaximize size={16} stroke={1.8} />
                        <span>全景预览</span>
                    </button>
                    <button
                        className={cn(
                            "inline-flex items-center justify-center gap-[7px]",
                            "min-w-0 min-h-[34px] px-[11px] border-0 rounded-[9px]",
                            "bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none whitespace-nowrap cursor-pointer",
                            "hover:bg-nomi-ink-05 hover:text-nomi-ink",
                        )}
                        type='button'
                        aria-label='四视图截图'
                        title='四视图截图'
                        onClick={() => panoramaFourViewRef.current?.()}>
                        <IconLayoutGrid size={16} stroke={1.8} />
                        <span>四视图截图</span>
                    </button>
                    <span
                        className={cn("w-px h-[22px] bg-[rgba(18,24,38,0.1)]")}
                    />
                    <label
                        className={cn(
                            "inline-flex items-center justify-center gap-[7px]",
                            "min-w-0 min-h-[34px] px-[11px] border-0 rounded-[9px]",
                            "bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none whitespace-nowrap cursor-pointer",
                            "hover:bg-nomi-ink-05 hover:text-nomi-ink",
                        )}>
                        <IconUpload size={16} stroke={1.8} />
                        <span>重新上传</span>
                        <input
                            className='hidden'
                            type='file'
                            accept='image/*'
                            onChange={handlePanoramaFileChange}
                        />
                    </label>
                </div>
            ) : null}

            {(node.kind === "image" || isAssetKind || isImageLikeGenerationNodeKind(node.kind)) &&
            selected &&
            !readOnly &&
            node.result?.type === "image" &&
            node.result.url ? (
                <NodeImageEditToolbar
                    node={node}
                    splittingGridSize={imageEditing.splittingGridSize}
                    cropMode={imageEditing.cropMode}
                    imageOpBusy={imageEditing.imageOpBusy}
                    onMakeup={() => applyFixationMakeup(node)}
                    onGridSplit={(g) => void imageEditing.handleImageGridSplit(g)}
                    onCrop={() => imageEditing.setCropMode(true)}
                    onTransform={(op) => void imageEditing.handleImageTransform(op)}
                />
            ) : null}

            {/* 视频等无编辑工具条的结果：单独一条「下载」浮条（图片下载已并入上面的编辑工具条）。 */}
            <NodeResultDownloadButton node={node} selected={selected} />

            <header
                className={cn(
                    "generation-canvas-v2-node__header",
                    "absolute top-[10px] left-[10px] right-[10px] z-[2]",
                    "flex items-center justify-start gap-2 min-h-0 p-0",
                    "pointer-events-auto cursor-grab",
                )}>
                {showStatusBadge ? (
                    <span
                        className={cn(
                            "text-[10.5px] font-medium tracking-[0.06em] uppercase",
                            "py-[3px] px-2 rounded-[4px] backdrop-blur-[8px]",
                            "bg-nomi-paper/[0.82] text-nomi-ink-60",
                            "data-[status=success]:text-workbench-success-ink data-[status=success]:bg-workbench-success-soft",
                            "data-[status=error]:text-workbench-danger data-[status=error]:bg-workbench-danger-soft",
                        )}
                        data-status={status}>
                        {(isGenerating && node.progress?.message) || STATUS_LABEL[status] || status}
                    </span>
                ) : null}
                <TechnicalReviewBadge meta={node.meta} />
                {/* 锁徽标已从卡片移到 NodeGenerationComposer 底栏（编辑面板）——卡片预览保持干净，
                    锁定/解锁在选中节点时就近可达（用户反馈②）。 */}
                {/* E.2C-25 副本角标（spec §6.3）：跨分类独立副本永久显示。derivedFrom 仅承载跨分类独立副本语义(经 E.2C-16 migration);同分类重生成在 regeneratedFrom,不进此角标。 */}
                {node.derivedFrom ? (
                    <button
                        type='button'
                        className='generation-canvas-v2-node__derived-badge'
                        aria-label={
                            sourceNodeExists
                                ? `定位源节点：${sourceNodeLabel}`
                                : "源节点已不存在"
                        }
                        title={independentCopyLabel}
                        disabled={!sourceNodeExists}
                        onClick={handleFocusSourceNode}
                        onPointerDown={(event) => event.stopPropagation()}>
                        <IconCopy size={13} stroke={1.8} aria-hidden='true' />
                        <span>独立副本</span>
                    </button>
                ) : null}
                {hasResult ? (
                    <button
                        type='button'
                        className={cn(
                            "ml-auto inline-grid place-items-center w-6 h-6 rounded-full",
                            "bg-nomi-paper/[0.82] text-nomi-ink-60 hover:text-nomi-ink",
                            "backdrop-blur-[8px] cursor-pointer pointer-events-auto",
                            "transition-colors duration-150",
                        )}
                        aria-label='查看生成记录'
                        title='生成记录 / Provenance'
                        onClick={(event) => {
                            event.stopPropagation();
                            setProvenanceOpen(true);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}>
                        <IconInfoCircle size={14} stroke={1.6} />
                    </button>
                ) : null}
            </header>

            <ProvenancePanel
                node={node}
                open={provenanceOpen}
                onClose={() => setProvenanceOpen(false)}
            />

            {/* 失败态：错误卡铺满节点正文（自身 absolute inset-0 z-[5]），
                盖住占位底纹但不挡 composer/resize/handles。 */}
            {status === "error" && node.error ? (
                <NodeErrorReport
                    message={node.error}
                    onRetry={() => { void runGenerationNode(node.id) }}
                />
            ) : null}

            {/* [DESIGN-CARDS-07] 卡片分发：非 shots 分类直接渲染对应 card 组件
          preview div + composer 在卡片模式下隐藏 */}
            {isCardKind ? (
                <div className='w-full h-full rounded-nomi shadow-nomi-md overflow-hidden'>
                    {renderKind === "character-card" && (
                        <CharacterCardNode node={node} />
                    )}
                    {renderKind === "scene-card" && (
                        <SceneCardNode node={node} />
                    )}
                    {renderKind === "prop-card" && <PropCardNode node={node} />}
                    {renderKind === "audio-strip" && (
                        <AudioStripNode node={node} />
                    )}
                </div>
            ) : null}

            {/* C5: 文本节点 —— 可编辑文档 body。外层不裁剪，让浮动格式条能浮到节点上方
                （圆角/阴影/裁剪在 TextDocumentNode 内层 body）。 */}
            {isTextKind ? (
                <div className='w-full h-full'>
                    <TextDocumentNode node={node} />
                </div>
            ) : null}

            <div
                className={cn(
                    "generation-canvas-v2-node__preview",
                    "relative w-full h-full min-h-0 overflow-hidden",
                    "rounded-nomi shadow-nomi-md cursor-grab touch-none",
                    // 棋盘格占位底纹只在「未生成」态出现；有结果后节点尺寸已贴合图片比例，
                    // 不再露出底纹，避免图片外面套一层框。
                    !hasResult &&
                        "bg-[repeating-linear-gradient(45deg,var(--nomi-ink-05)_0_23px,var(--nomi-ink-20)_23px_24px)]",
                    // [DESIGN-CARDS-07] 卡片模式隐藏 preview div；C5 文本节点同理。
                    (isCardKind || isTextKind) && "hidden",
                )}
                data-timeline-draggable={canSendToTimeline ? "true" : "false"}
                draggable={false}>
                {node.kind === "scene3d" ? (
                    <React.Suspense fallback={<Scene3DEditorLoading />}>
                        <Scene3DEditor
                            node={node}
                            width={visualSize.width}
                            height={previewHeight}
                            readOnly={readOnly}
                        />
                    </React.Suspense>
                ) : node.kind === "panorama" ? (
                    node.result?.url || node.meta?.imageUrl ? (
                        <PanoramaViewer
                            imageUrl={
                                (node.result?.url ||
                                    node.meta?.imageUrl) as string
                            }
                            width={visualSize.width}
                            height={previewHeight}
                            onEnterFullscreen={(trigger) => {
                                panoramaFullscreenRef.current = trigger;
                            }}
                            onCaptureFourView={(trigger) => {
                                panoramaFourViewRef.current = trigger;
                            }}
                            onScreenshot={handlePanoramaScreenshot}
                        />
                    ) : (
                        <div
                            className={cn(
                                "flex w-full h-full items-center justify-center",
                            )}>
                            <label
                                className={cn(
                                    "inline-flex items-center justify-center",
                                    "min-w-[156px] min-h-[48px] px-[18px]",
                                    "text-nomi-ink-60 text-[13px] cursor-pointer",
                                )}
                                onPointerDown={(event) =>
                                    event.stopPropagation()
                                }>
                                <span>+ 上传全景图</span>
                                <input
                                    className='hidden'
                                    type='file'
                                    accept='image/*'
                                    onChange={handlePanoramaFileChange}
                                />
                            </label>
                        </div>
                    )
                ) : node.result?.url ? (
                    node.result.type === "video" ? (
                        <video
                            className={cn(
                                "w-full h-full min-h-0 object-contain pointer-events-auto",
                                "bg-nomi-ink-05 select-none",
                            )}
                            src={buildVideoPlaybackUrl(node.result.url)}
                            crossOrigin='use-credentials'
                            controls
                            muted
                            playsInline
                            preload='metadata'
                            draggable={false}
                            onPointerDown={(e) => e.stopPropagation()}
                            onLoadedMetadata={(event) => {
                                updateMediaDimensions(
                                    event.currentTarget.videoWidth,
                                    event.currentTarget.videoHeight,
                                );
                            }}
                            onError={(event) => {
                                void diagnoseVideoPlaybackFailure(
                                    node.result?.url || "",
                                    event.currentTarget.error,
                                ).then(logVideoPlaybackFailure);
                            }}
                        />
                    ) : (
                        <NomiImage
                            className={cn(
                                "w-full h-full min-h-0 object-contain pointer-events-none",
                                "select-none",
                            )}
                            src={node.result.url}
                            alt=''
                            onLoad={(event) => {
                                updateMediaDimensions(
                                    event.currentTarget.naturalWidth,
                                    event.currentTarget.naturalHeight,
                                );
                            }}
                        />
                    )
                ) : (
                    <PendingGenerationPlaceholder
                        selected={selected}
                        needsFirstFrame={needsFirstFrame}
                        waitingUpstream={hasFrameSourceEdge}
                        shotIndex={shotIndex}
                        title={node.title}
                        prompt={node.prompt}
                    />
                )}
                {imageEditing.cropMode &&
                (node.kind === "image" || isAssetKind) &&
                node.result?.type === "image" &&
                node.result.url ? (
                    <ImageCropOverlay
                        imageUrl={node.result.url}
                        onConfirm={(rect) => {
                            void imageEditing.handleCropConfirm(rect);
                        }}
                        onCancel={() => imageEditing.setCropMode(false)}
                    />
                ) : null}
            </div>

            {isGenerating ? <GeneratingOverlay /> : null}
            {canSendToTimeline && node.kind !== "scene3d" ? (
                <div
                    role='button'
                    tabIndex={0}
                    className={cn(
                        "generation-canvas-v2-node__timeline-drag group",
                        "absolute top-1/2 right-[-42px] z-[7]",
                        "inline-flex items-center justify-center",
                        "w-8 h-12 m-0 p-0 border border-[rgba(18,24,38,0.08)] rounded-full",
                        "bg-nomi-paper/[0.94] text-nomi-ink-60 font-[inherit]",
                        "cursor-grab backdrop-blur-[10px] shadow-[0_10px_26px_rgba(18,24,38,0.14)]",
                        "-translate-y-1/2 transition-[transform,color,background,box-shadow] duration-150 ease-out",
                        "active:cursor-grabbing active:scale-[0.96]",
                        "hover:bg-white hover:text-nomi-ink hover:shadow-[0_12px_30px_rgba(18,24,38,0.18)]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--workbench-accent)] focus-visible:ring-offset-2",
                    )}
                    aria-label={TIMELINE_DRAG_HANDLE_LABEL}
                    title={TIMELINE_DRAG_HANDLE_LABEL}
                    draggable
                    onClick={handleAddToTimelineAtPlayhead}
                    onDragStart={handleTimelineDragStart}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        handleAddToTimelineAtPlayhead(event);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}>
                    <IconGripVertical
                        size={18}
                        stroke={2.1}
                        aria-hidden='true'
                    />
                    <span
                        className={cn(
                            "pointer-events-none absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2",
                            "whitespace-nowrap rounded-full px-2.5 py-1.5",
                            "bg-[rgba(18,24,38,0.92)] text-white text-[11px] font-medium leading-none",
                            "opacity-0 translate-x-[-4px] transition-[opacity,transform] duration-150",
                            "group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0",
                        )}>
                        {TIMELINE_DRAG_HANDLE_LABEL}
                    </span>
                </div>
            ) : null}

            {/* composer：仅生成类节点 + 选中时浮出（A1.5 抽成 NodeGenerationComposer）。
          素材节点（asset）/ 全景图不挂它；点中节点才弹出 prompt + 参数 + 生成按钮，未选中只看图。 */}
            {selected &&
            !readOnly &&
            node.kind !== "panorama" &&
            node.kind !== "scene3d" &&
            !isAssetKind ? (
                <NodeGenerationComposer node={node} visualSize={visualSize} />
            ) : null}
            {selected && !readOnly
                ? RESIZE_DIRECTIONS.map((direction) => (
                      <WorkbenchButton
                          key={direction}
                          className={cn(
                              "generation-canvas-v2-node__resize-zone",
                              `generation-canvas-v2-node__resize-zone--${direction}`,
                              "absolute z-[6] p-0 border-0 bg-transparent",
                              "focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-2",
                              (direction === "n" || direction === "s") &&
                                  "left-[10px] w-[calc(100%-20px)] h-[10px] cursor-ns-resize",
                              direction === "n" && "top-[-5px]",
                              direction === "s" && "bottom-[-5px]",
                              (direction === "e" || direction === "w") &&
                                  "top-[10px] w-[10px] h-[calc(100%-20px)] cursor-ew-resize",
                              direction === "e" && "right-[-5px]",
                              direction === "w" && "left-[-5px]",
                              (direction === "ne" ||
                                  direction === "nw" ||
                                  direction === "se" ||
                                  direction === "sw") &&
                                  "w-4 h-4",
                              (direction === "ne" || direction === "sw") &&
                                  "cursor-nesw-resize",
                              (direction === "nw" || direction === "se") &&
                                  "cursor-nwse-resize",
                              direction === "ne" && "top-[-8px] right-[-8px]",
                              direction === "nw" && "top-[-8px] left-[-8px]",
                              direction === "se" &&
                                  "right-[-8px] bottom-[-8px]",
                              direction === "sw" && "bottom-[-8px] left-[-8px]",
                          )}
                          aria-label={`从${direction}方向调整节点尺寸`}
                          title='调整节点尺寸'
                          onPointerDown={handleResizePointerDown(direction)}
                      />
                  ))
                : null}
        </article>
    );
}

// v0.7.1 perf: memo wrap — node 引用稳定时跳过 rerender。
// 父级 GenerationCanvas 须保证 node 是 zustand store 里同一引用（zustand immer 默认就是）。
const BaseGenerationNode = React.memo(
    BaseGenerationNodeImpl,
    (prev, next) =>
        prev.node === next.node &&
        prev.selected === next.selected &&
        prev.readOnly === next.readOnly &&
        prev.focusFlash === next.focusFlash,
);
BaseGenerationNode.displayName = "BaseGenerationNode";
export default BaseGenerationNode;
