import { build } from "vite";
import { build as bundle } from "esbuild";
import { readFile, writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
/** Canonical public website; immutable preview deployments keep this identity. */
const origin = "https://usagekit.dev";
/** One prerendered page per audience, each with its own title and description. */
const pages = [
  {
    page: "home",
    path: "",
    title: "Usagekit: open-source usage metering for paid API calls",
    description:
      "Open-source usage metering for paid API calls: reserve budget before dispatch, settle exact costs from receipts, show usage with shadcn blocks and React hooks, and put spend limits on AI agents.",
  },
  {
    page: "components",
    path: "components/",
    title: "shadcn blocks for usage, costs and budgets | Usagekit",
    description:
      "Copyable shadcn blocks and headless React hooks for usage, provider costs and budgets, for Radix and Base UI, rendered from an exact Meter.",
  },
  {
    page: "agents",
    path: "agents/",
    title: "API proxy with spend limits for AI agents | Usagekit",
    description:
      "A local API proxy and usage dashboard for AI agents: provider keys stay in an encrypted vault, and metered calls reserve budget before dispatch.",
  },
  {
    page: "docs",
    path: "docs/",
    title: "Usagekit documentation: get started",
    description:
      "Get started with Usagekit: published runtime packages, Postgres storage, headless React hooks, shared reads, budget editing and public shadcn registry installation.",
  },
];
const attribute = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
const withMeta = (html, { title, description, path }) =>
  html
    .replace(
      "</head>",
      `    <link rel="canonical" href="${origin}/${path}" />\n    <meta property="og:url" content="${origin}/${path}" />\n  </head>`,
    )
    .replace(/<title>[^<]*<\/title>/, `<title>${title.replaceAll("&", "&amp;")}</title>`)
    .replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
      (_, start, end) => `${start}${attribute(title)}${end}`,
    )
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      (_, start, end) => `${start}${attribute(description)}${end}`,
    )
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
      (_, start, end) => `${start}${attribute(description)}${end}`,
    );

await build({ configFile: `${directory}vite.config.ts` });
const serverEntry = `${directory}.site-ssr.mjs`;
try {
  await bundle({
    entryPoints: [`${directory}src/entry-server.tsx`],
    outfile: serverEntry,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    logLevel: "warning",
  });
  const { render } = await import(serverEntry);
  const template = await readFile(`${directory}dist/site/index.html`, "utf8");
  for (const page of pages) {
    const html = withMeta(template, page).replace("<!--app-html-->", render(page.page));
    if (!html.includes(`<title>${page.title.replaceAll("&", "&amp;")}</title>`))
      throw new Error(`Page metadata was not applied to /${page.path}`);
    await mkdir(`${directory}dist/site/${page.path}`, { recursive: true });
    await writeFile(`${directory}dist/site/${page.path}index.html`, html);
  }
  await writeFile(
    `${directory}dist/site/sitemap.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
      .map(({ path }) => `  <url><loc>${origin}/${path}</loc></url>`)
      .join("\n")}\n</urlset>\n`,
  );
  await copyFile(`${directory}../../LICENSE`, `${directory}dist/site/LICENSE`);
  await copyFile(`${directory}../../NOTICE`, `${directory}dist/site/NOTICE`);
  console.log(
    `Prerendered ${pages.map(({ path }) => `/${path}`).join(", ")}. No remote services or provider calls.`,
  );
} finally {
  await rm(serverEntry, { force: true });
}
