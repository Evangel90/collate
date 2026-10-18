import type { ReactNode } from "react"

const PATHS: Record<string, ReactNode> = {
  shield: <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z M9 12l2 2 4-4" />,
  chart: <path d="M4 20V10 M10 20V4 M16 20v-7 M3 20h18" />,
  alert: <path d="M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />,
  clock: <path d="M12 7v5l3 2 M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  map: <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z M9 4v14 M15 6v14" />,
  edit: <path d="M12 20h9 M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />,
  ban: <path d="M5.6 5.6l12.8 12.8 M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  flame: <path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-3 2-4 2-7 1.5 1 2.5 2 3-3z" />,
  lock: <path d="M6 11h12v10H6z M8 11V7a4 4 0 018 0v4" />,
  upload: <path d="M12 16V4 M7 9l5-5 5 5 M4 20h16" />,
  eye: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 100-6 3 3 0 000 6z" />,
  expand: <path d="M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7" />,
  minimise: <path d="M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7" />,
  database: <path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  copy: <path d="M9 9h11v11H9z M5 15H4V4h11v1" />,
  plus: <path d="M12 5v14 M5 12h14" />,
  trash: <path d="M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13" />,
  link: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  users: <path d="M16 20v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 18.5V20 M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M20 20v-1.5a3.5 3.5 0 00-2.5-3.4 M15.5 4.2a3.5 3.5 0 010 6.6" />,
}

/** A small stroke icon. Decorative: hidden from assistive tech. */
export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

/** Placeholder bars while Arkiv answers. */
export function Skeleton({ lines = 3, height = 14 }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton" role="status" aria-label="Loading from Arkiv">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} style={{ height, width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  )
}

/** Card heading with an icon chip. */
export function CardTitle({ icon, id, children, tone }: { icon: string; id?: string; children: ReactNode; tone?: "critical" | "good" }) {
  return (
    <h2 id={id} className="card-title">
      <span className={`icon-chip${tone ? ` icon-chip-${tone}` : ""}`}>
        <Icon name={icon} size={16} />
      </span>
      {children}
    </h2>
  )
}
