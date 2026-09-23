import { type Context, UsageError } from "../context.js";
export const token = (c: Context, command?: string) => {
  if (command === "show-path") return c.rest("/token/path");
  if (command === "rotate") return c.rest("/token/rotate", "POST");
  throw new UsageError();
};
