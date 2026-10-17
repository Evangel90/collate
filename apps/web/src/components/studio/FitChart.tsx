import type { AggRow } from "@collate/core"
import { BarChart, type Series } from "@collate/core/ui"
import { useEffect, useRef, useState } from "react"

/** Tracks an element's content width; 0 until the first measurement. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.round(el.clientWidth))
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

/** Tracks the viewport height, so rows can grow to fill a tall screen. */
function useViewportHeight() {
  const [height, setHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return height
}

type Props = {
  title: string
  groups: AggRow[]
  series: Series[]
  onSelect: (group: AggRow) => void
  /** Viewport height the chart should leave for the header and counts around it. */
  reserve?: number
}

/**
 * The bar chart drawn at its real pixel width instead of scaled from 640 units, so labels stay at
 * reading size on a wide screen and on a phone. Rows grow to use a tall viewport, bars stay at or
 * under 24px, and the label column is capped so it never squeezes the bars on a narrow screen.
 */
export function FitChart({ title, groups, series, onSelect, reserve = 380 }: Props) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const viewport = useViewportHeight()
  const narrow = width > 0 && width < 600
  // Matches the font sizes set for .studio-fit in studio.css (13px narrow, 15px wide).
  const charW = narrow ? 7.4 : 8.6
  const longest = Math.max(0, ...groups.map((g) => g.group.length))
  const labelCap = Math.round((width || 640) * (narrow ? 0.42 : 0.3))
  const labelWidth = Math.min(labelCap, Math.max(narrow ? 84 : 132, 20 + charW * longest))
  const maxLabelChars = Math.max(4, Math.floor((labelWidth - 16) / charW))
  const fill = Math.floor((viewport - reserve) / Math.max(1, groups.length))
  const rowHeight = Math.min(narrow ? 52 : 64, Math.max(narrow ? 42 : 48, fill))

  return (
    <div ref={ref} className={`studio-fit${narrow ? " is-narrow" : ""}`}>
      {width > 0 && (
        <BarChart
          title={title}
          groups={groups}
          series={series}
          width={width}
          labelWidth={labelWidth}
          maxLabelChars={maxLabelChars}
          rowHeight={rowHeight}
          barHeight={narrow ? 20 : 24}
          valueWidth={narrow ? 64 : 92}
          onSelect={onSelect}
        />
      )}
    </div>
  )
}
