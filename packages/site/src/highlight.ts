export type Lang = "tsx" | "shell";
export type Token = { text: string; kind: TokenKind | null };
export type TokenKind =
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "fn"
  | "type"
  | "tag"
  | "flag";

const keywords = new Set(
  (
    "import from export const let var function return async await if else type interface new " +
    "typeof as default true false null undefined for of in throw try catch satisfies extends void"
  ).split(" "),
);
const tsx =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(<\/?[A-Za-z][\w.]*)|(\b\d[\d_]*(?:\.\d+)?n?\b)|([A-Za-z_$][\w$]*)/g;
const shell =
  /(#[^\n]*)|("(?:\\.|[^"\\\n])*"|'[^'\n]*')|(\s--?[\w-]+)|(^|\n)([\w./-]+)(?![\w./-]*=)/g;

/** A small, dependency-free highlighter for the TypeScript, TSX and shell on this site. */
export function tokenize(source: string, lang: Lang): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  const plain = (end: number) => {
    if (end > last) tokens.push({ text: source.slice(last, end), kind: null });
  };
  const pattern = new RegExp(lang === "tsx" ? tsx : shell);
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const [text] = match;
    const start = match.index;
    let kind: TokenKind | null = null;
    if (lang === "shell") {
      if (match[5] !== undefined) {
        plain(start + (match[4]?.length ?? 0));
        tokens.push({ text: match[5], kind: "fn" });
        last = start + text.length;
        continue;
      }
      kind = match[1] ? "comment" : match[2] ? "string" : "flag";
    } else if (match[1]) kind = "comment";
    else if (match[2]) kind = "string";
    else if (match[3]) {
      // A generic argument follows an identifier; a JSX tag does not.
      if (/[\w$]/.test(source[start - 1] ?? "")) {
        pattern.lastIndex = start + 1;
        continue;
      }
      kind = "tag";
    } else if (match[4]) kind = "number";
    // An object key or member that happens to be a keyword, like { from: … }, stays plain.
    else if (
      keywords.has(text) &&
      source[start - 1] !== "." &&
      !/^\s*:/.test(source.slice(start + text.length))
    )
      kind = "keyword";
    else if (/^\s*\(/.test(source.slice(start + text.length))) kind = "fn";
    else if (/^[A-Z]/.test(text)) kind = "type";
    plain(start);
    tokens.push({ text, kind });
    last = start + text.length;
  }
  plain(source.length);
  return tokens;
}

/** Tokens split at newlines, one array per source line. */
export function tokenLines(source: string, lang: Lang): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokenize(source, lang)) {
    const parts = token.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ text: part, kind: token.kind });
    });
  }
  return lines;
}
