export type TerminalView = "legacy" | "codex";

export function resolveTerminalView(pathname: string, baseUrl: string): TerminalView {
  const normalizedBase = `/${baseUrl.replace(/^\/+|\/+$/g, "")}`;
  const normalizedPath = `/${pathname.replace(/^\/+|\/+$/g, "")}`;
  const relativePath = normalizedPath === normalizedBase
    ? "/"
    : normalizedPath.startsWith(`${normalizedBase}/`)
      ? normalizedPath.slice(normalizedBase.length)
      : normalizedPath;
  return relativePath === "/codex" ? "codex" : "legacy";
}
