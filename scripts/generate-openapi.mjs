import { writeFileSync } from "node:fs";
import { generateOpenApi } from "../packages/http/dist/openapi.js";
writeFileSync("packages/http/openapi.json", JSON.stringify(generateOpenApi(), null, 2) + "\n");
