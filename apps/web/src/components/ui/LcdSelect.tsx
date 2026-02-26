import type { SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement>;

export function LcdSelect({ className = "", ...props }: Props) {
  return <select {...props} className={`lcd-select ${className}`.trim()} />;
}
