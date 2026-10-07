# Static website and component preview

The preview combines the project home, component and agent pages, prerendered docs, both interactive
registry consumers and their shadcn JSON artifacts. It does not deploy a backend or publish
the private React, views, server and registry workspaces.

From the repository root, with the pinned Node/npm runtime:

```sh
npm ci
npm run preview:build
```

The helper produces Vercel Build Output API v3 files in `.vercel/output`, with all public
files under `.vercel/output/static`. It preserves `.vercel/project.json` and any local
Vercel environment files. The output is ignored by Git. The root `vercel.json` supplies
the installation and build commands; no functions, middleware, cron or deployment action
are included. See the [Build Output API documentation](https://vercel.com/docs/build-output-api).

| Route                           | Content                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `/`                             | Usagekit project home                                          |
| `/components/`                  | shadcn blocks and headless React hooks                         |
| `/agents/`                      | Local API proxy and agent spend controls                       |
| `/docs/`                        | Existing prerendered checkout documentation                    |
| `/examples/`                    | Variant links, block index and origin-derived install commands |
| `/examples/new-york/`           | Actual New York/Radix components with local fixtures           |
| `/examples/base/`               | Actual Base UI/Vega components with local fixtures             |
| `/r/radix/<block>.json`         | New York/Radix shadcn block                                    |
| `/r/base/<block>.json`          | Base UI/Vega shadcn block                                      |
| `/r/<block>.json`               | New York/Radix default alias                                   |
| `/r/registry.json`              | Default registry index                                         |
| `/r/{radix,base}/registry.json` | Variant registry index                                         |
| `/preview-manifest.json`        | Source revision, dirty state and artifact boundaries           |

The examples build from ignored copies prepared by the existing registry consumer helper.
Tracked website and consumer sources are not rewritten. Both consumers use the actual
React hooks and all 20 blocks. Metering, budget editing and provider controls use in-memory
fixtures: changes reset on reload, there are no provider calls, and credential inputs are
for demo values only. The registry's host primitive dependencies remain shadcn names;
there is no invented production origin. Copy commands use the current preview's origin.

The UI packages are checkout-only. A configured consumer must first install the local
`@usagekit/react` and `@usagekit/views` packages and their dependencies as described in
the website docs. Hosting the JSON does not make those dependencies available from npm.
The public organization link is <https://github.com/usagekit>; a source repository has
not been created by this helper.

For a local static check, use a separate free port:

```sh
python3 -m http.server 5190 --bind 127.0.0.1 --directory .vercel/output/static
```

Open `/examples/` and both variants, exercise a fixture mutation and reload to confirm
it resets. Check the JSON links and the host-derived install command. The Vercel config
adds explicit directory redirects and serves files without a blanket SPA fallback, so
unknown routes remain 404. The Python server is only a local file server; it does not
emulate Vercel headers or routing configuration.

Building is separate from deployment. Verify the target Vercel project and obtain explicit
deployment authorization. Exact-SHA promotion to main requires separate approval.
A preview can host this static artifact; the production provider-management server still
requires its own authenticated, authorized and durable host integration. Bisibility's
React adoption is locally verified and remains separate from its existing production
metering integration.
