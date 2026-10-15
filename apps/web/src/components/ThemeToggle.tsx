import { useEffect, useState } from "react"
import { prefs } from "../lib/collate"

type Theme = "system" | "light" | "dark"
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" }
const LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" }

function apply(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

/** Cycles Auto → Light → Dark. The choice stays in this browser only. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (prefs.get("theme") as Theme) ?? "system")
  useEffect(() => apply(theme), [theme])
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        const next = NEXT[theme]
        setTheme(next)
        prefs.set("theme", next)
      }}
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]]}`}
      title={`Theme: ${LABEL[theme]}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        {theme === "dark" ? (
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        ) : theme === "light" ? (
          <path d="M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5.6 5.6L4.2 4.2 M19.8 19.8l-1.4-1.4 M5.6 18.4l-1.4 1.4 M19.8 4.2l-1.4 1.4 M12 17a5 5 0 100-10 5 5 0 000 10z" />
        ) : (
          <path d="M12 3a9 9 0 100 18V3z M12 3a9 9 0 010 18" />
        )}
      </svg>
      <span>{LABEL[theme]}</span>
    </button>
  )
}
