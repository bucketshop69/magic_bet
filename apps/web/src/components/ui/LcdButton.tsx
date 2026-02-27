import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "tab";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  active?: boolean;
  icon?: string;
};

export function LcdButton({
  variant = "primary",
  active = false,
  icon,
  className = "",
  children,
  ...props
}: Props) {
  const variantClass =
    variant === "primary"
      ? "lcd-btn lcd-btn-primary"
      : variant === "secondary"
      ? "lcd-btn lcd-btn-secondary"
      : "lcd-btn lcd-btn-tab";

  const activeClass = active ? "lcd-btn-active" : "";
  return (
    <button
      {...props}
      className={`${variantClass} ${activeClass} ${className}`.trim()}
    >
      <span className="lcd-btn-content">
        {icon ? (
          <span className="material-symbols-outlined lcd-btn-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span>{children}</span>
      </span>
    </button>
  );
}
