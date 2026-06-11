/**
 * One-shot fixer: adds `import { httpError } from "..."` to files
 * that USE httpError but never import it (regression from the previous
 * migrate-throws.js whose ensureImport guard short-circuited too early).
 *
 * Logic:
 *   1. If file uses `httpError(` but no `import.*httpError` line → add one.
 *   2. If file already imports something from `errors/index.js`, extend that
 *      import to include httpError instead of adding a second import line.
 *   3. Path is computed relative to each file's location.
 */
import fs from "node:fs";
import path from "node:path";

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield full;
  }
}

function relImportToErrors(filePath) {
  const fromDir = path.dirname(filePath);
  const target = path.resolve("src/utils/errors/index.js");
  let rel = path.relative(fromDir, target).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

let fixed = 0;
for (const file of walk("src/modules")) {
  let src = fs.readFileSync(file, "utf8");

  const usesHttpError = /\bhttpError\s*\(/.test(src);
  const importsHttpError = /import\s*\{[^}]*\bhttpError\b[^}]*\}\s*from/.test(src);

  if (!usesHttpError || importsHttpError) continue;

  // Case A: there's an existing import from errors — extend it
  const errImportRe =
    /import\s*\{([^}]+)\}\s*from\s*(["'])([^"']*errors[^"']*)\2/;
  const m = errImportRe.exec(src);
  if (m) {
    const names = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.includes("httpError")) names.push("httpError");
    const replacement = `import { ${names.join(", ")} } from ${m[2]}${m[3]}${m[2]}`;
    src = src.replace(errImportRe, replacement);
  } else {
    // Case B: no existing errors import — insert one after the last import line
    const lines = src.split("\n");
    let lastImport = -1;
    for (let i = 0; i < Math.min(lines.length, 80); i++) {
      if (/^import\s/.test(lines[i])) lastImport = i;
    }
    const insertAt = lastImport === -1 ? 0 : lastImport + 1;
    const importPath = relImportToErrors(file);
    lines.splice(insertAt, 0, `import { httpError } from "${importPath}";`);
    src = lines.join("\n");
  }

  fs.writeFileSync(file, src, "utf8");
  console.log("✓ " + file);
  fixed++;
}

console.log(`\nFixed ${fixed} files`);
