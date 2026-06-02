import React from "react";
import "./workbench.css";
import "./workbench-ai.css";
import NomiAppBar from "../ui/app-shell/NomiAppBar";
import {
    isWorkspaceMode,
    useWorkbenchStore,
    type WorkspaceMode,
} from "./workbenchStore";
import { cn } from "../utils/cn";
import ProjectExplorerSidebar from "./explorer/ProjectExplorerSidebar";

const CreationWorkspace = React.lazy(
    () => import("./creation/CreationWorkspace"),
);
const GenerationWorkspace = React.lazy(
    () => import("./generation/GenerationWorkspace"),
);
const PreviewWorkspace = React.lazy(() => import("./preview/PreviewWorkspace"));

type WorkbenchShellProps = {
    generation: React.ReactNode;
    generationAi?: React.ReactNode;
    generationAiLayout?: "sidebar" | "overlay";
    projectId?: string | null;
    projectName?: string;
    onBackToLibrary?: () => void;
    onOpenModelCatalog?: () => void;
    onRenameProject?: (name: string) => void;
};

const STEP_PARAM_BY_MODE: Record<WorkspaceMode, string> = {
    creation: "create",
    generation: "generate",
    preview: "preview",
};

const MODE_BY_STEP_PARAM: Record<string, WorkspaceMode> = {
    create: "creation",
    creation: "creation",
    generate: "generation",
    generation: "generation",
    preview: "preview",
};

type WorkspaceSlotProps = {
    active: boolean;
    children: React.ReactNode;
    label: string;
};

function WorkspaceLoading({ label }: { label: string }): JSX.Element {
    return (
        <div
            className={cn(
                "workbench-shell__loading",
                "w-full h-full bg-workbench-bg",
            )}
            aria-label={`${label}加载中`}
        />
    );
}

function WorkspaceSlot({
    active,
    children,
    label,
}: WorkspaceSlotProps): JSX.Element {
    return (
        <div
            className={cn(
                "workbench-shell__workspace",
                "w-full h-full min-w-0 min-h-0",
            )}
            hidden={!active}>
            <React.Suspense
                fallback={active ? <WorkspaceLoading label={label} /> : null}>
                {children}
            </React.Suspense>
        </div>
    );
}

function readWorkspaceModeFromUrl(): WorkspaceMode {
    if (typeof window === "undefined") return "generation";
    try {
        const step = String(
            new URL(window.location.href).searchParams.get("step") || "",
        ).trim();
        return MODE_BY_STEP_PARAM[step] || "generation";
    } catch {
        return "generation";
    }
}

function writeWorkspaceModeToUrl(mode: WorkspaceMode): void {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const step = STEP_PARAM_BY_MODE[mode];
    if (url.searchParams.get("step") === step) return;
    url.searchParams.set("step", step);
    window.history.replaceState(null, "", url.toString());
}

export default function WorkbenchShell({
    generation,
    generationAi,
    generationAiLayout = "sidebar",
    projectId,
    projectName,
    onBackToLibrary,
    onOpenModelCatalog,
    onRenameProject,
}: WorkbenchShellProps): JSX.Element {
    const workspaceMode = useWorkbenchStore((state) => state.workspaceMode);
    const setWorkspaceMode = useWorkbenchStore(
        (state) => state.setWorkspaceMode,
    );
    const [mountedWorkspaceModes, setMountedWorkspaceModes] = React.useState<
        WorkspaceMode[]
    >(() => [workspaceMode]);

    React.useEffect(() => {
        const initialMode = readWorkspaceModeFromUrl();
        setWorkspaceMode(initialMode);
        writeWorkspaceModeToUrl(initialMode);

        const onPopState = () => {
            setWorkspaceMode(readWorkspaceModeFromUrl());
        };
        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, [setWorkspaceMode]);

    React.useEffect(() => {
        setMountedWorkspaceModes((current) =>
            current.includes(workspaceMode)
                ? current
                : [...current, workspaceMode],
        );
    }, [workspaceMode]);

    const handleWorkspaceModeChange = React.useCallback(
        (mode: WorkspaceMode) => {
            if (!isWorkspaceMode(mode)) return;
            setWorkspaceMode(mode);
            writeWorkspaceModeToUrl(mode);
        },
        [setWorkspaceMode],
    );

    return (
        <div
            className={cn(
                "workbench-shell",
                "grid grid-rows-[var(--workbench-topbar-height)_minmax(0,1fr)]",
                "w-full h-full min-h-0",
                "bg-workbench-bg text-workbench-ink",
                'font-nomi-sans [font-feature-settings:"cv02","cv03","cv04","tnum"]',
            )}
            data-workspace-mode={workspaceMode}>
            <NomiAppBar
                workspaceMode={workspaceMode}
                onWorkspaceModeChange={handleWorkspaceModeChange}
                projectName={projectName}
                onBackToLibrary={onBackToLibrary}
                onOpenModelCatalog={onOpenModelCatalog}
                onRenameProject={onRenameProject}
            />

            {/* 左侧面板重做: 分类导航 + 文件树统一收进 ProjectExplorerSidebar 的双 Tab。
          创作模式是纯文稿写作，不挂项目资源树（仅生成/预览显示）。 */}
            <main
                className={cn(
                    "workbench-shell__body",
                    "relative min-w-0 min-h-0 overflow-hidden flex",
                )}>
                {workspaceMode !== "creation" ? (
                    <ProjectExplorerSidebar projectId={projectId ?? null} />
                ) : null}
                <div className='flex-1 min-w-0 min-h-0 relative'>
                    {mountedWorkspaceModes.includes("creation") ? (
                        <WorkspaceSlot
                            active={workspaceMode === "creation"}
                            label='创作区'>
                            <CreationWorkspace />
                        </WorkspaceSlot>
                    ) : null}
                    {mountedWorkspaceModes.includes("generation") ? (
                        <WorkspaceSlot
                            active={workspaceMode === "generation"}
                            label='生成区'>
                            <GenerationWorkspace
                                canvas={generation}
                                aiSidebar={generationAi}
                                aiLayout={generationAiLayout}
                            />
                        </WorkspaceSlot>
                    ) : null}
                    {mountedWorkspaceModes.includes("preview") ? (
                        <WorkspaceSlot
                            active={workspaceMode === "preview"}
                            label='预览区'>
                            <PreviewWorkspace />
                        </WorkspaceSlot>
                    ) : null}
                </div>
            </main>
        </div>
    );
}
