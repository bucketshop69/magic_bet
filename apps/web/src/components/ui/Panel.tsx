import type { PropsWithChildren } from "react";

type Props = PropsWithChildren<{
  className?: string;
}>;

export function Panel({ className = "", children }: Props) {
  return <section className={`lcd-panel ${className}`.trim()}>{children}</section>;
}
