/**
 * The components page header and its only h1. The live gallery right below is the visual, so the
 * header stays typographic: what the blocks are, where they come from and two ways in.
 */
export function ComponentsHero() {
  return (
    <section className="cmp-hero" aria-labelledby="cmp-title">
      <div className="container cmp-inner">
        <h1 id="cmp-title" className="cmp-title">
          shadcn blocks for usage, costs and budgets.
        </h1>
        <p className="cmp-lede">
          Copy usage, cost and budget blocks into your app for Radix or Base UI, or take the
          headless React hooks and keep your own design. Every block reads exact figures from the
          Meter.
        </p>
        <div className="cmp-side">
          <div className="cmp-actions">
            <a className="btn btn-primary" href="#components">
              Browse the blocks
            </a>
            <a className="btn btn-outline" href="/docs/#components">
              Read the docs
            </a>
          </div>
          <p className="cmp-note">
            The React layer and registry run from the repository checkout, not npm.
          </p>
        </div>
      </div>
    </section>
  );
}
