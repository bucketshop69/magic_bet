import type { ButtonHTMLAttributes } from "react";
import { LcdButton } from "./LcdButton";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function NavTabButton({ active = false, ...props }: Props) {
  return <LcdButton {...props} variant="tab" active={active} />;
}
