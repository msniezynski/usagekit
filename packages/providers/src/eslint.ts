import type { Rule } from "eslint";

/** A small glob dialect: * matches one path segment; ** matches any depth. */
function matches(pattern: string, value: string): boolean {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        source += "(?:.*/)?";
        i++;
      } else source += ".*";
    } else if (c === "*") source += "[^/]*";
    else source += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`).test(value);
}
export const noDirectProviderCall: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Keep provider clients inside reviewed metering wrappers." },
    schema: [
      {
        type: "object",
        properties: {
          modules: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          wrappers: { type: "array", items: { type: "string", minLength: 1 } },
        },
        required: ["modules", "wrappers"],
        additionalProperties: false,
      },
    ],
    messages: { direct: "Import {{module}} only from an approved metering wrapper." },
  },
  create(context) {
    const options = context.options[0] as { modules: string[]; wrappers: string[] } | undefined;
    if (!options) return {};
    const cwd = context.cwd.replace(/\\/g, "/").replace(/\/$/, "");
    const filename = context.filename.replace(/\\/g, "/");
    const relative = filename.startsWith(cwd + "/") ? filename.slice(cwd.length + 1) : filename;
    if (options.wrappers.some((pattern) => matches(pattern, relative))) return {};
    const check = (node: Rule.Node, value: unknown) => {
      if (typeof value === "string" && options.modules.some((pattern) => matches(pattern, value)))
        context.report({ node, messageId: "direct", data: { module: value } });
    };
    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => {
        if (node.source.type === "Literal") check(node, node.source.value);
      },
      CallExpression: (node) => {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments[0]?.type === "Literal"
        )
          check(node, node.arguments[0].value);
      },
    };
  },
};
const plugin = { rules: { "no-direct-provider-call": noDirectProviderCall } };
export default plugin;
