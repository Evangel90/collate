import { useEffect, useState } from "react"

export type Route = { path: string; params: URLSearchParams }

function parse(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/"
  const [path = "/", query = ""] = hash.split("?")
  return { path, params: new URLSearchParams(query) }
}

/** Hash routing, so the static build works from any host, a fork, or a local file server. */
export function useRoute(): Route {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  return route
}

export function href(path: string, params?: Record<string, string>): string {
  const query = params ? `?${new URLSearchParams(params)}` : ""
  return `#${path}${query}`
}
