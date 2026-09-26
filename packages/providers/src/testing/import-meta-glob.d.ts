/** Vite's static glob import, available to tests run by vitest. */
interface ImportMeta {
  glob(pattern: string, options: { eager: true; import: "default" }): Record<string, unknown>;
}
