export const publishable = ["@usagekit/core", "@usagekit/store", "@usagekit/meter"];
export const registry = "https://registry.npmjs.org/";

export function validateReleaseIdentity({ branch, head, tagCommit, tagType }) {
  if (branch !== "main" || tagCommit !== head || tagType !== "tag")
    throw new Error("Release requires main and an annotated version tag on its exact HEAD.");
}

export function validatePackFiles(files, terms, conformance = false) {
  for (const file of files) {
    if (
      !/^(package\.json|LICENSE|NOTICE|dist\/.+\.(js|d\.ts))$/.test(file) ||
      file.includes(".test.") ||
      terms.some((term) => file.toLowerCase().includes(term.toLowerCase()))
    )
      throw new Error(`Forbidden tarball file: ${file}`);
  }
  for (const required of ["LICENSE", "NOTICE", "dist/index.js", "dist/index.d.ts"])
    if (!files.includes(required)) throw new Error(`Missing tarball file: ${required}`);
  if (conformance)
    for (const required of ["dist/conformance/index.js", "dist/conformance/index.d.ts"])
      if (!files.includes(required)) throw new Error(`Missing tarball file: ${required}`);
}
