/**
 * tests/migrate-throws.js
 *
 * One-shot migration: converts the legacy raw-throw pattern
 *
 *     new Error("msg", { cause: <statusCode> })
 *     Object.assign(new Error("msg"), { cause: <statusCode> })
 *     return next(new Error("msg", { cause: <statusCode> }))
 *
 * into the canonical AppError factory
 *
 *     httpError(<statusCode>, "msg")
 *
 * It also injects `import { httpError } from "..."` if the file is
 * missing it. Idempotent — re-running on already-migrated files is a
 * no-op.
 *
 * Usage:
 *   node tests/migrate-throws.js --dry          # preview changes
 *   node tests/migrate-throws.js                # apply
 */

import fs from "node:fs";
import path from "node:path";

const DRY = process.argv.includes("--dry");
const ROOT = "src/modules";

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield full;
  }
}

/**
 * Compute the import path from the file location back to
 * src/utils/errors/index.js, so we can synthesize the import line.
 */
function relImportToErrors(filePath) {
  const fromDir = path.dirname(filePath);
  const target = path.resolve("src/utils/errors/index.js");
  let rel = path.relative(fromDir, target).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function ensureImport(src, importPath) {
  if (/\bhttpError\b/.test(src) && /from\s+["'][^"']*errors[^"']*["']/.test(src)) {
    // Already imports SOMETHING from errors — check if httpError is in it.
    const re = /import\s*\{([^}]+)\}\s*from\s*(["'])([^"']*errors[^"']*)\2/;
    const m = re.exec(src);
    if (m && /\bhttpError\b/.test(m[1])) return src; // already has it
    if (m) {
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (!names.includes("httpError")) names.push("httpError");
      const replacement = `import { ${names.join(", ")} } from ${m[2]}${m[3]}${m[2]}`;
      return src.replace(re, replacement);
    }
  }
  if (/\bhttpError\b/.test(src)) return src; // imported via re-export, leave alone

  // No existing errors import — insert one after the last top-of-file import.
  const lines = src.split("\n");
  let lastImport = -1;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    if (/^import\s/.test(lines[i])) lastImport = i;
  }
  const insertAt = lastImport === -1 ? 0 : lastImport + 1;
  lines.splice(insertAt, 0, `import { httpError } from "${importPath}";`);
  return lines.join("\n");
}

/**
 * Transformations. Each returns [newSrc, replacementCount].
 */
function migrate(src) {
  let count = 0;

  // 1. Object.assign(new Error("msg"), { cause: <num> })
  // Supports single-quoted or double-quoted message.
  src = src.replace(
    /Object\.assign\(\s*new Error\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)\s*,\s*\{\s*cause\s*:\s*(\d{3})\s*,?\s*\}\s*\)/g,
    (_m, q, msg, status) => {
      count++;
      return `httpError(${status}, ${q}${msg}${q})`;
    },
  );

  // 2. new Error("msg", { cause: <num> }) — single line
  src = src.replace(
    /new Error\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*\{\s*cause\s*:\s*(\d{3})\s*,?\s*\}\s*\)/g,
    (_m, q, msg, status) => {
      count++;
      return `httpError(${status}, ${q}${msg}${q})`;
    },
  );

  // 3. Multi-line: new Error(\n  "msg",\n  { cause: 400 },\n)
  //    Same idea, but the body can have line breaks between args.
  src = src.replace(
    /new Error\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*\{\s*cause\s*:\s*(\d{3})\s*,?\s*\}\s*,?\s*\)/gs,
    (_m, q, msg, status) => {
      count++;
      return `httpError(${status}, ${q}${msg}${q})`;
    },
  );

  return [src, count];
}

let totalFiles = 0;
let totalReplacements = 0;
const changedFiles = [];

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  const [migrated, count] = migrate(src);
  if (count === 0 || migrated === src) continue;

  const importPath = relImportToErrors(file);
  const withImport = ensureImport(migrated, importPath);

  totalFiles++;
  totalReplacements += count;
  changedFiles.push({ file, count });

  if (!DRY) {
    fs.writeFileSync(file, withImport, "utf8");
  }
}

console.log(
  `${DRY ? "[DRY RUN] " : ""}${totalReplacements} throws migrated across ${totalFiles} files`,
);
for (const { file, count } of changedFiles) {
  console.log(`  ${count.toString().padStart(3)} → ${file}`);
}
