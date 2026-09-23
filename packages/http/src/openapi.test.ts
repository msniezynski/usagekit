import { expect, test } from "vitest";
import { generateOpenApi } from "./openapi.js";
// Checked through a web-standard import; generation itself is a separate Node script.
import document from "../openapi.json" with { type: "json" };
test("checked-in OpenAPI is current", () => {
  expect(generateOpenApi()).toEqual(document);
});
