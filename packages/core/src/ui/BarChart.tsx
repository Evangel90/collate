import { useState } from "react"
import type { AggRow } from "../types"
import { formatNumber } from "./format"

export type Series = { field: string; label: string }

export type BarChartProps = {
  groups: AggRow[]
  series: Series[]
  /** Called with the group when its bar is clicked, e.g. to show provenance. */
  onSelect?: (group: AggRow) => void
  /** Accessible description of what the chart shows. */
  title: string
}

const BAR = 22 // px, under the 24px cap
const ROW = 44
const GAP = 2 // surface gap between stacked segments
const LABEL_W = 116
const VALUE_W = 64

/**
 * Horizontal stacked bars: one row per group, one segment per series, colored by series slot
 * (`--collate-series-N`). Identity never rests on color alone: there is a legend, a hover tooltip,
 * and the table view carries every number.
 */
export function BarChart({ groups, series, onSelect, title }: BarChartProps) {
  const [hover, setHover] = useState<{ group: AggRow; x: number; y: number } | undefined>()
  const width = 640
  const plotW = width - LABEL_W - VALUE_W
  const max = Math.max(1, ...groups.map((g) => series.reduce((s, x) => s + (g.sums[x.field] ?? 0), 0)))
  const height = Math.max(ROW, groups.length * ROW)

  return (
    <figure className="collate-chart">
      <div className="collate-legend" aria-hidden="true">
        {series.map((s, i) => (
          <span key={s.field} className="collate-legend-item">
            <span className="collate-swatch" style={{ background: `var(--collate-series-${i + 1})` }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="collate-chart-body">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          role="img"
          aria-label={`${title}. ${groups.map((g) => `${g.group}: ${series.map((s) => `${s.label} ${g.sums[s.field] ?? 0}`).join(", ")}`).join("; ")}`}
          onMouseLeave={() => setHover(undefined)}
        >
          <line x1={LABEL_W} x2={LABEL_W} y1={0} y2={height} className="collate-axis" />
          {groups.map((g, row) => {
            const y = row * ROW + (ROW - BAR) / 2
            let x = LABEL_W
            const total = series.reduce((s, x) => s + (g.sums[x.field] ?? 0), 0)
            const segments = series
              .map((s, i) => ({ s, i, w: ((g.sums[s.field] ?? 0) / max) * plotW }))
              .filter((seg) => seg.w > 0)
            return (
              <g
                key={g.group}
                className={onSelect ? "collate-bar-row collate-clickable" : "collate-bar-row"}
                onClick={() => onSelect?.(g)}
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                  setHover({ group: g, x: e.clientX - box.left, y: e.clientY - box.top })
                }}
              >
                {/* Hit target: the whole row, bigger than the mark. */}
                <rect x={0} y={row * ROW} width={width} height={ROW} fill="transparent" />
                <text x={LABEL_W - 10} y={y + BAR / 2} dominantBaseline="middle" textAnchor="end" className="collate-label">
                  {g.group}
                </text>
                {segments.map((seg, k) => {
                  const last = k === segments.length - 1
                  const w = Math.max(0, seg.w - (last ? 0 : GAP))
                  const el = last ? (
                    <path key={seg.s.field} d={roundedEnd(x, y, w, BAR, Math.min(4, w))} fill={`var(--collate-series-${seg.i + 1})`} />
                  ) : (
                    <rect key={seg.s.field} x={x} y={y} width={w} height={BAR} fill={`var(--collate-series-${seg.i + 1})`} />
                  )
                  x += seg.w
                  return el
                })}
                <text x={x + 8} y={y + BAR / 2} dominantBaseline="middle" className="collate-value">
                  {formatNumber(total)}
                </text>
              </g>
            )
          })}
        </svg>
        {hover && (
          <div className="collate-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }} role="status">
            <strong>{hover.group.group}</strong>
            {series.map((s, i) => (
              <div key={s.field} className="collate-tooltip-row">
                <span className="collate-swatch" style={{ background: `var(--collate-series-${i + 1})` }} />
                <span>{s.label}</span>
                <span className="collate-num">{formatNumber(hover.group.sums[s.field] ?? 0)}</span>
              </div>
            ))}
            <div className="collate-muted">
              {hover.group.count} {hover.group.count === 1 ? "entity" : "entities"}
              {onSelect ? " · click for proof" : ""}
            </div>
          </div>
        )}
      </div>
    </figure>
  )
}

/** A bar segment square at the start and rounded (radius r) at its data end. */
function roundedEnd(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`
}
