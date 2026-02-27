import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement>;

export function LcdInput({ className = "", ...props }: Props) {
  return <input {...props} className={`lcd-input ${className}`.trim()} />;
}
