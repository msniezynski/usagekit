import { renderToString } from "react-dom/server";
import { App } from "./app.js";
import type { Page } from "./app.js";

export function render(page: Page) {
  return renderToString(<App page={page} />);
}
