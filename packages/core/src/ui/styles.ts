/**
 * Default styles for the UI components. Inject once with `<style>{collateCss}</style>` or copy into
 * your own stylesheet. Everything reads CSS custom properties, so a host restyles by overriding
 * them. Series slots 1–3 are validated colorblind-safe as a set in both modes.
 */
export const collateCss = `
.collate-root {
  color-scheme: light;
  --collate-surface: #fcfcfb;
  --collate-plane: #f9f9f7;
  --collate-ink: #0b0b0b;
  --collate-ink-2: #52514e;
  --collate-muted: #6b6a65;
  --collate-grid: #e1e0d9;
  --collate-axis: #c3c2b7;
  --collate-border: rgba(11, 11, 11, 0.1);
  --collate-accent: #1c5cab;
  --collate-critical: #b42f2f;
  --collate-series-1: #2a78d6;
  --collate-series-2: #eb6834;
  --collate-series-3: #1baf7a;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .collate-root {
    color-scheme: dark;
    --collate-surface: #1a1a19;
    --collate-plane: #0d0d0d;
    --collate-ink: #f0efec;
    --collate-ink-2: #c3c2b7;
    --collate-muted: #9a9890;
    --collate-grid: #2c2c2a;
    --collate-axis: #383835;
    --collate-border: rgba(255, 255, 255, 0.1);
    --collate-accent: #6da7ec;
    --collate-critical: #e66767;
    --collate-series-1: #3987e5;
    --collate-series-2: #d95926;
    --collate-series-3: #199e70;
  }
}
:root[data-theme="dark"] .collate-root {
  color-scheme: dark;
  --collate-surface: #1a1a19;
  --collate-plane: #0d0d0d;
  --collate-ink: #f0efec;
  --collate-ink-2: #c3c2b7;
  --collate-muted: #9a9890;
  --collate-grid: #2c2c2a;
  --collate-axis: #383835;
  --collate-border: rgba(255, 255, 255, 0.1);
  --collate-accent: #6da7ec;
  --collate-critical: #e66767;
  --collate-series-1: #3987e5;
  --collate-series-2: #d95926;
  --collate-series-3: #199e70;
}
.collate-chart { margin: 0; }
.collate-chart-body { position: relative; }
.collate-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0 0 8px; font-size: 13px; color: var(--collate-ink-2); }
.collate-legend-item { display: inline-flex; align-items: center; gap: 6px; }
.collate-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex: none; }
.collate-axis { stroke: var(--collate-axis); stroke-width: 1; }
.collate-label { fill: var(--collate-ink-2); font-size: 13px; }
.collate-value { fill: var(--collate-ink); font-size: 13px; font-variant-numeric: tabular-nums; }
.collate-bar-row:hover rect[fill="transparent"] { fill: var(--collate-grid); fill-opacity: 0.35; }
.collate-clickable { cursor: pointer; }
.collate-tooltip { position: absolute; z-index: 5; pointer-events: none; min-width: 180px; padding: 8px 10px; border-radius: 8px;
  background: var(--collate-surface); color: var(--collate-ink); border: 1px solid var(--collate-border);
  box-shadow: 0 4px 16px rgba(0,0,0,0.12); font-size: 13px; display: grid; gap: 4px; }
.collate-tooltip-row { display: grid; grid-template-columns: 10px 1fr auto; gap: 8px; align-items: center; }
.collate-num { text-align: right; font-variant-numeric: tabular-nums; }
.collate-muted { color: var(--collate-muted); font-size: 13px; }
.collate-table-wrap { overflow-x: auto; }
.collate-table { width: 100%; border-collapse: collapse; font-size: 14px; color: var(--collate-ink); }
.collate-table th, .collate-table td { padding: 8px 10px; border-bottom: 1px solid var(--collate-grid); text-align: left; white-space: nowrap; }
.collate-table th.collate-num, .collate-table td.collate-num { text-align: right; }
.collate-table thead th { color: var(--collate-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.collate-table tbody th { font-weight: 500; }
.collate-table tfoot th, .collate-table tfoot td { font-weight: 600; border-bottom: none; }
.collate-table tr.collate-clickable:hover { background: var(--collate-plane); }
.collate-dialog { width: min(640px, calc(100vw - 32px)); max-height: min(80vh, 720px); padding: 20px; border-radius: 12px;
  border: 1px solid var(--collate-border); background: var(--collate-surface); color: var(--collate-ink); }
.collate-dialog::backdrop { background: rgba(0,0,0,0.4); }
.collate-dialog-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.collate-dialog-head h3 { margin: 0; font-size: 18px; }
.collate-icon-btn { border: none; background: transparent; color: var(--collate-ink-2); font-size: 24px; line-height: 1; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
.collate-icon-btn:hover { background: var(--collate-plane); }
.collate-proof-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.collate-proof-list li { padding: 10px 12px; border: 1px solid var(--collate-border); border-radius: 8px; display: grid; gap: 6px; }
.collate-proof-main { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
.collate-proof-desc { color: var(--collate-ink-2); font-size: 13px; font-variant-numeric: tabular-nums; }
.collate-proof-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; font-size: 13px; color: var(--collate-ink-2); }
.collate-proof-meta a { color: var(--collate-accent); }
.collate-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--collate-plane); border: 1px solid var(--collate-border); font-size: 12px; color: var(--collate-ink-2); }
`
