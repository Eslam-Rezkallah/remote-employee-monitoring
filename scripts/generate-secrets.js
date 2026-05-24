#!/usr/bin/env node
import { randomBytes } from "node:crypto";

const secrets = {
  USER_ACCESS_TOKEN: randomBytes(48).toString("hex"),
  USER_REFRESH_TOKEN: randomBytes(48).toString("hex"),
  ADMIN_ACCESS_TOKEN: randomBytes(48).toString("hex"),
  ADMIN_REFRESH_TOKEN: randomBytes(48).toString("hex"),
};

console.log("# Paste these into your .env.dev / .env.prod:\n");
for (const [key, value] of Object.entries(secrets)) {
  console.log(`${key}=${value}`);
}
