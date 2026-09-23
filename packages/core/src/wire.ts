/** Restore integers only in recognizable Meter DTOs. Generic metadata fields retain their strings.
 * This performs conversion, not validation. HTTP validates strict wire schemas before calling it.
 */
export function decodeMeterJson(text: string): unknown {
  const decimal = (v: unknown): v is string => typeof v === "string" && /^-?\d+$/.test(v);
  return JSON.parse(text, (_key, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const v = value as Record<string, unknown>,
      keys = Object.keys(v);
    if (keys.length === 2 && v.currency === "USD" && decimal(v.units))
      return { ...v, units: BigInt(v.units) };
    if (
      keys.length === 3 &&
      typeof v.unit === "string" &&
      typeof v.scale === "number" &&
      decimal(v.value)
    )
      return { ...v, value: BigInt(v.value) };
    if (
      v.dimensions &&
      typeof v.dimensions === "object" &&
      Array.isArray(v.measurements) &&
      v.cost &&
      typeof v.cost === "object" &&
      ["byok", "platform"].includes(String(v.fundingSource)) &&
      typeof v.costOwner === "string" &&
      decimal(v.unknownOperations)
    )
      return { ...v, unknownOperations: BigInt(v.unknownOperations) };
    return value;
  });
}
