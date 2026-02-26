export const LCD_THEME = {
  font: {
    display: '"VT323", "Courier New", monospace',
    body: '"Inter", "Segoe UI", sans-serif',
  },
  color: {
    appBgTop: "#8e9f76",
    appBgBottom: "#7f9068",
    panel: "#a8b68c",
    panelMuted: "#97a77a",
    surface: "#b2c095",
    borderStrong: "#2f3f2f",
    borderSoft: "#6f7f5f",
    textPrimary: "#132013",
    textMuted: "#405040",
    textInverse: "#a8b68c",
    interactive: "#1f2f1f",
    interactiveHover: "#314431",
    disabled: "#78886b",
  },
  radius: {
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "20px",
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
  },
  shadow: {
    panel: "inset 0 0 0 1px #6f7f5f",
    elevated: "0 6px 18px rgba(19, 32, 19, 0.18)",
  },
} as const;

type CssVarMap = Record<`--${string}`, string>;

function toCssVars(): CssVarMap {
  return {
    "--font-display": LCD_THEME.font.display,
    "--font-body": LCD_THEME.font.body,
    "--color-app-bg-top": LCD_THEME.color.appBgTop,
    "--color-app-bg-bottom": LCD_THEME.color.appBgBottom,
    "--color-panel": LCD_THEME.color.panel,
    "--color-panel-muted": LCD_THEME.color.panelMuted,
    "--color-surface": LCD_THEME.color.surface,
    "--color-border-strong": LCD_THEME.color.borderStrong,
    "--color-border-soft": LCD_THEME.color.borderSoft,
    "--color-text-primary": LCD_THEME.color.textPrimary,
    "--color-text-muted": LCD_THEME.color.textMuted,
    "--color-text-inverse": LCD_THEME.color.textInverse,
    "--color-interactive": LCD_THEME.color.interactive,
    "--color-interactive-hover": LCD_THEME.color.interactiveHover,
    "--color-disabled": LCD_THEME.color.disabled,
    "--radius-sm": LCD_THEME.radius.sm,
    "--radius-md": LCD_THEME.radius.md,
    "--radius-lg": LCD_THEME.radius.lg,
    "--radius-xl": LCD_THEME.radius.xl,
    "--space-xs": LCD_THEME.spacing.xs,
    "--space-sm": LCD_THEME.spacing.sm,
    "--space-md": LCD_THEME.spacing.md,
    "--space-lg": LCD_THEME.spacing.lg,
    "--space-xl": LCD_THEME.spacing.xl,
    "--shadow-panel": LCD_THEME.shadow.panel,
    "--shadow-elevated": LCD_THEME.shadow.elevated,
  };
}

export function applyLcdThemeTokens(root: HTMLElement = document.documentElement) {
  const vars = toCssVars();
  Object.entries(vars).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
}
