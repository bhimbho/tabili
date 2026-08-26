import type { Theme } from "@glideapps/glide-data-grid";

/**
 * glide-data-grid ships a light theme by default, which fights the rest of the
 * app. These values track the neutral palette used elsewhere, with slightly
 * lifted row/header surfaces so the grid still reads as a distinct pane.
 */
export const darkGridTheme: Partial<Theme> = {
  accentColor: "#6366f1",
  accentFg: "#ffffff",
  accentLight: "rgba(99, 102, 241, 0.20)",

  textDark: "#ededed",
  textMedium: "#a3a3a3",
  textLight: "#737373",
  textBubble: "#e5e5e5",

  bgCell: "#141416",
  bgCellMedium: "#181819",

  bgHeader: "#202023",
  bgHeaderHasFocus: "#2c2c31",
  bgHeaderHovered: "#28282c",
  textHeader: "#d4d4d4",
  textGroupHeader: "#a3a3a3",
  textHeaderSelected: "#ffffff",

  bgIconHeader: "#a3a3a3",
  fgIconHeader: "#171717",

  bgBubble: "#262626",
  bgBubbleSelected: "#333333",
  bgSearchResult: "rgba(245, 158, 11, 0.18)",

  borderColor: "rgba(255, 255, 255, 0.075)",
  horizontalBorderColor: "rgba(255, 255, 255, 0.045)",
  drilldownBorder: "rgba(255, 255, 255, 0.12)",

  linkColor: "#818cf8",

  cellHorizontalPadding: 10,
  cellVerticalPadding: 4,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", ui-sans-serif, system-ui, sans-serif',
  baseFontStyle: "12px",
  headerFontStyle: "600 12px",
  editorFontSize: "12px",
};

/** Light theme mirrors the same structure so the grid reads as a pane. */
export const lightGridTheme: Partial<Theme> = {
  accentColor: "#4f46e5",
  accentFg: "#ffffff",
  accentLight: "rgba(79, 70, 229, 0.14)",

  textDark: "#1c1c1e",
  textMedium: "#52525b",
  textLight: "#8e8e93",
  textBubble: "#27272a",

  bgCell: "#ffffff",
  bgCellMedium: "#f7f7f8",

  bgHeader: "#f0f0f2",
  bgHeaderHasFocus: "#e6e6e9",
  bgHeaderHovered: "#eaeaed",
  textHeader: "#3f3f46",
  textGroupHeader: "#71717a",
  textHeaderSelected: "#18181b",

  bgIconHeader: "#71717a",
  fgIconHeader: "#ffffff",

  bgBubble: "#e4e4e7",
  bgBubbleSelected: "#d4d4d8",
  bgSearchResult: "rgba(245, 158, 11, 0.25)",

  borderColor: "rgba(0, 0, 0, 0.09)",
  horizontalBorderColor: "rgba(0, 0, 0, 0.05)",
  drilldownBorder: "rgba(0, 0, 0, 0.14)",

  linkColor: "#4f46e5",

  cellHorizontalPadding: 10,
  cellVerticalPadding: 4,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", ui-sans-serif, system-ui, sans-serif',
  baseFontStyle: "12px",
  headerFontStyle: "600 12px",
  editorFontSize: "12px",
};

/** Returns the grid theme for the given app theme. */
export function gridThemeFor(mode: "dark" | "light"): Partial<Theme> {
  return mode === "light" ? lightGridTheme : darkGridTheme;
}

/** Cell tints for staged edits, inserts and deletions. */
export const EDIT_THEME = { bgCell: "#3a2c0a", textDark: "#fcd34d" };
export const DELETE_THEME = { bgCell: "#3a1414", textDark: "#fca5a5" };
export const INSERT_THEME = { bgCell: "#0c2f1e", textDark: "#86efac" };
