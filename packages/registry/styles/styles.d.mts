export type StyleSheet =
  | "new-york"
  | "vega"
  | "nova"
  | "maia"
  | "lyra"
  | "mira"
  | "luma"
  | "sera"
  | "rhea";
export type PublishedStyle = {
  name: string;
  variant: "radix" | "base";
  sheet: StyleSheet;
  label: string;
};

export declare const sheets: readonly StyleSheet[];
export declare const styles: readonly PublishedStyle[];
export declare const legacy: { radix: string; base: string };
export declare const tokenPattern: RegExp;
export declare function styleMap(sheet: StyleSheet): Record<string, string>;
export declare function styleSource(source: string, map: Record<string, string>): string;
