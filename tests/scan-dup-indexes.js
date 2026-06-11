// Quick scanner for duplicate Mongoose indexes
// (field with `unique: true` AND a schema.index({ field: ... }) line).
import fs from "node:fs";
import path from "node:path";

const dir = "src/DB/Model";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".model.js"));

let total = 0;
for (const file of files) {
  const src = fs.readFileSync(path.join(dir, file), "utf8");
  const uniqueFields = new Set();
  const fieldRe = /(\w+)\s*:\s*\{[^{}]*unique\s*:\s*true[^{}]*\}/gs;
  let m;
  while ((m = fieldRe.exec(src)) !== null) uniqueFields.add(m[1]);

  for (const field of uniqueFields) {
    const pattern = `\\.index\\(\\s*\\{\\s*${field}\\s*:`;
    const re = new RegExp(pattern, "g");
    if (re.test(src)) {
      console.log(`DUP  ${file}  field=${field}`);
      total++;
    }
  }
}
console.log(`scanned ${files.length} models, ${total} duplicate(s) found`);
