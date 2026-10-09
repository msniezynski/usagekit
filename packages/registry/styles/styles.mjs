import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStyleMap } from "shadcn/utils";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Usagekit's own elements follow the host's shadcn style. Sources name each styled element with a
 * `cn-usage-*` token; every sheet in this folder defines all tokens for one style, in the format
 * of shadcn's style sheets. A build bakes one sheet into the sources for each published style.
 */
export const sheets = ["new-york", "vega", "nova", "maia", "lyra", "mira", "luma", "sera", "rhea"];

/** Published styles: the legacy New York style, then every shadcn style for Radix and Base UI. */
export const styles = [
  { name: "new-york", variant: "radix", sheet: "new-york", label: "New York" },
  ...sheets.slice(1).flatMap((sheet) => {
    const label = sheet[0].toUpperCase() + sheet.slice(1);
    return [
      { name: `radix-${sheet}`, variant: "radix", sheet, label },
      { name: `base-${sheet}`, variant: "base", sheet, label },
    ];
  }),
];

/** The legacy routes keep their styles: radix is New York and base is Base UI Vega. */
export const legacy = { radix: "new-york", base: "base-vega" };

export const tokenPattern = /\bcn-usage-[a-z0-9]+(?:-[a-z0-9]+)*\b/g;

export function styleMap(sheet) {
  return createStyleMap(readFileSync(join(here, `${sheet}.css`), "utf8"));
}

/**
 * Replaces every token in a source with its classes. Tokens only appear in class lists, so a
 * textual pass also reaches template literals and class maps. An empty definition drops the token
 * with one neighbouring space.
 */
export function styleSource(source, map) {
  return source.replace(
    /( ?)(\bcn-usage-[a-z0-9]+(?:-[a-z0-9]+)*\b)( ?)/g,
    (_, before, token, after) => {
      const classes = map[token];
      if (classes === undefined) throw new Error(`Unknown style token ${token}`);
      if (classes) return `${before}${classes}${after}`;
      return before && after ? " " : "";
    },
  );
}
