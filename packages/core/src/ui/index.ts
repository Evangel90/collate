/**
 * Optional React components for @collate/core: a live-panel hook, a stacked bar chart, tables and
 * a provenance dialog. Wrap them in an element with class `collate-root` and include `collateCss`.
 */
export { usePanel } from "./usePanel"
export { BarChart, type BarChartProps, type Series } from "./BarChart"
export { GroupTable, RowTable, type Column } from "./PanelTable"
export { Provenance, type ProvenanceProps } from "./Provenance"
export { AttrList, type AttrListProps } from "./AttrList"
export { collateCss } from "./styles"
export { expiresIn, formatAttr, formatNumber, humanizeKey, shortAddress } from "./format"
