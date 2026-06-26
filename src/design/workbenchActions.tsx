import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

export type WorkbenchIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: ReactNode;
    label: string;
};

export function WorkbenchIconButton({
    icon,
    label,
    className,
    type = "button",
    ...props
}: WorkbenchIconButtonProps): JSX.Element {
    const rootClassName = cn(
        "tc-workbench-icon-button",
        "inline-grid place-items-center",
        "size-8 rounded-workbench-control border-0",
        "bg-transparent text-workbench-muted",
        "cursor-pointer",
        "transition-[background,color] duration-150 ease-out",
        "hover:bg-workbench-hover hover:text-workbench-ink",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "[&>svg]:size-4 [&>svg]:stroke-2",
        className,
    );

    return (
        <button
            {...props}
            className={rootClassName}
            type={type}
            aria-label={props["aria-label"] ?? label}
            title={props.title ?? label}>
            {icon}
        </button>
    );
}

export type WorkbenchButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
};

export function WorkbenchButton({
    children,
    className,
    type = "button",
    ...props
}: WorkbenchButtonProps): JSX.Element {
    const rootClassName = cn(
        "tc-workbench-button",
        "inline-flex items-center justify-center gap-1.5",
        "h-8 px-3 rounded-workbench-control",
        "border border-workbench-border-soft",
        "bg-workbench-surface text-workbench-ink text-body-sm font-medium",
        "cursor-pointer",
        "transition-[background,border-color,color,box-shadow] duration-150 ease-out",
        "hover:bg-workbench-hover",
        "active:bg-workbench-pressed",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "[&>svg]:size-4 [&>svg]:stroke-2",
        className,
    );

    return (
        <button {...props} className={rootClassName} type={type}>
            {children}
        </button>
    );
}
