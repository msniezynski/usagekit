/** RFC 6901 JSON pointer lookup; undefined when any step is missing. */
export function pointer(value: unknown, path: string): unknown {
  if (path === "") return value;
  let current = value;
  for (const raw of path.replace(/^\//, "").split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key))
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
