// The prepared showcase replaces this file with a store over every style; a consumer host has one.
export type ShowcaseStyle = {
  name: string;
  variant: "radix" | "base";
  sheet: string;
  label: string;
};
export const showcaseStyles: readonly ShowcaseStyle[] = [];
export function useShowcaseStyle(): string {
  return "new-york";
}
export function setShowcaseStyle(_name: string): void {}
