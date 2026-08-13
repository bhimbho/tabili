import type { Theme } from "@glideapps/glide-data-grid";

/**
 * glide-data-grid ships a light theme by default, which fights the rest of the
 * app. These values track the neutral palette used elsewhere, with slightly
 * lifted row/header surfaces so the grid still reads as a distinct pane.
 */
export const darkGridTheme: Partial<Theme> = {
  accentColor: "#6366f1",
  accentFg: "#ffffff",
  accentLight: "rgba(99, 102, 241, 0.22)",

  textDark: "#e5e5e5",
  textMedium: "#a3a3a3",
  textLight: "#737373",
  textBubble: "#e5e5e5",

  bgCell: "#171717",
  bgCellMedium: "#1c1c1c",

  bgHeader: "#1f1f1f",
  bgHeaderHasFocus: "#2a2a2a",
  bgHeaderHovered: "#262626",
  textHeader: "#d4d4d4",
  textGroupHeader: "#a3a3a3",
  textHeaderSelected: "#ffffff",

  bgIconHeader: "#a3a3a3",
  fgIconHeader: "#171717",

  bgBubble: "#262626",
  bgBubbleSelected: "#333333",
  bgSearchResult: "rgba(245, 158, 11, 0.18)",

  borderColor: "rgba(255, 255, 255, 0.08)",
  horizontalBorderColor: "rgba(255, 255, 255, 0.05)",
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

/** Cell tints for staged edits, inserts and deletions. */
export const EDIT_THEME = { bgCell: "#3a2c0a", textDark: "#fcd34d" };
export const DELETE_THEME = { bgCell: "#3a1414", textDark: "#fca5a5" };
export const INSERT_THEME = { bgCell: "#0c2f1e", textDark: "#86efac" };
/** Foreign-key cells get the link colour so the jump affordance is discoverable. */
export const FK_THEME = { textDark: "#818cf8" };
