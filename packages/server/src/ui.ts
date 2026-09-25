import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Built UI next to the compiled server: dist/ui, produced by `npm run build`. */
export const defaultUiRoot = join(dirname(fileURLToPath(import.meta.url)), "ui");
const types: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};

/** Resolves "/" and "/assets/<name>" only; names cannot contain separators or traversal. */
export function uiFile(root: string, path: string) {
  const relative =
    path === "/" ? "index.html" : /^\/assets\/[\w.-]+$/.test(path) ? path.slice(1) : null;
  if (!relative || relative.includes("..")) return null;
  const file = join(root, relative);
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  const type = types[relative.split(".").at(-1) ?? ""] ?? "application/octet-stream";
  return {
    body: readFileSync(file),
    headers: {
      "Content-Type": type,
      "Cache-Control":
        relative === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  };
}
