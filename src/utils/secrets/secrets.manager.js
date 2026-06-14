/**
 * utils/secrets/secrets.manager.js
 *
 * Provider-agnostic secrets resolver.
 *
 * Today every secret lives in `process.env`. In prod you almost
 * always want them in a real manager (Doppler, AWS Secrets Manager,
 * GCP Secret Manager, HashiCorp Vault) for:
 *   • centralized rotation
 *   • access auditing
 *   • per-environment isolation without touching env files
 *
 * This module is the seam: every consumer calls `getSecret("FOO")`
 * (not `process.env.FOO` directly). When you switch providers you
 * change ONE file — the rest of the codebase keeps working.
 *
 * Selection:
 *   - SECRETS_PROVIDER=env       → process.env (default, what we ship)
 *   - SECRETS_PROVIDER=doppler   → fetched via Doppler CLI/env-injected
 *   - SECRETS_PROVIDER=aws       → AWS Secrets Manager (lazy SDK)
 *   - SECRETS_PROVIDER=vault     → HashiCorp Vault (lazy SDK)
 *
 * Doppler is recommended for SaaS — it injects vars into the process
 * env at boot, so we never see its API. With `provider=doppler` we
 * just verify the magic `DOPPLER_PROJECT` is set and otherwise read
 * from env, same as the default path.
 *
 * AWS / Vault are wired through dynamic imports so we don't take a
 * hard dep on either SDK; they only load when explicitly selected.
 */

import { childLogger } from "../logger/logger.js";

const log = childLogger("secrets");

const PROVIDER = (process.env.SECRETS_PROVIDER || "env").toLowerCase();

// Cache resolved values for the process lifetime. Secrets shouldn't
// change underneath a running process — when they do, we restart.
const _cache = new Map();
let _initialised = false;
let _awsClient = null;
let _vaultClient = null;

export async function initSecrets() {
  if (_initialised) return;
  _initialised = true;

  switch (PROVIDER) {
    case "env":
      log.info("secrets provider = env (process.env)");
      break;
    case "doppler":
      // Doppler injects env vars at boot. We just sanity-check.
      if (process.env.DOPPLER_PROJECT || process.env.DOPPLER_CONFIG) {
        log.info(
          {
            project: process.env.DOPPLER_PROJECT,
            config: process.env.DOPPLER_CONFIG,
          },
          "secrets provider = doppler",
        );
      } else {
        log.warn(
          "SECRETS_PROVIDER=doppler but DOPPLER_* envs missing — falling back to env",
        );
      }
      break;
    case "aws":
      try {
        const sdk = await import("@aws-sdk/client-secrets-manager");
        _awsClient = new sdk.SecretsManagerClient({
          region: process.env.AWS_REGION || "us-east-1",
        });
        log.info("secrets provider = aws-secrets-manager");
      } catch (err) {
        log.error({ err: err.message }, "AWS SDK not installed — install @aws-sdk/client-secrets-manager");
        throw new Error("AWS secrets provider selected but SDK not available");
      }
      break;
    case "vault":
      try {
        const { default: nodeVault } = await import("node-vault");
        _vaultClient = nodeVault({
          endpoint: process.env.VAULT_ADDR,
          token: process.env.VAULT_TOKEN,
        });
        log.info("secrets provider = vault");
      } catch (err) {
        log.error({ err: err.message }, "Vault SDK not installed — install node-vault");
        throw new Error("Vault secrets provider selected but SDK not available");
      }
      break;
    default:
      throw new Error(`Unknown SECRETS_PROVIDER: ${PROVIDER}`);
  }
}

/**
 * Resolve a secret by key. Returns null when the key is missing
 * (the caller decides whether that's fatal — e.g., the joi env
 * validator in src/config/env.js already enforces what's required).
 *
 * Cached for the process lifetime to avoid repeat upstream calls.
 */
export async function getSecret(key, { fresh = false } = {}) {
  if (!fresh && _cache.has(key)) return _cache.get(key);

  let value = null;
  switch (PROVIDER) {
    case "env":
    case "doppler":
      value = process.env[key] ?? null;
      break;
    case "aws":
      value = await fetchAws(key);
      break;
    case "vault":
      value = await fetchVault(key);
      break;
    default:
      value = process.env[key] ?? null;
  }

  if (value != null) _cache.set(key, value);
  return value;
}

async function fetchAws(key) {
  if (!_awsClient) return null;
  try {
    const sdk = await import("@aws-sdk/client-secrets-manager");
    const res = await _awsClient.send(
      new sdk.GetSecretValueCommand({ SecretId: key }),
    );
    return res.SecretString ?? null;
  } catch (err) {
    log.warn({ err: err.message, key }, "AWS secret fetch failed");
    return null;
  }
}

async function fetchVault(key) {
  if (!_vaultClient) return null;
  try {
    // Convention: secret paths like "secret/data/<app>/<key>".
    // Adjust to your Vault mount layout.
    const mount = process.env.VAULT_MOUNT || "secret/data";
    const appPath = process.env.VAULT_APP_PATH || "rem";
    const res = await _vaultClient.read(`${mount}/${appPath}/${key}`);
    return res?.data?.data?.value ?? res?.data?.value ?? null;
  } catch (err) {
    log.warn({ err: err.message, key }, "Vault secret fetch failed");
    return null;
  }
}

/** Test helper — drop the in-process cache. */
export function _resetSecretsCacheForTests() {
  _cache.clear();
}
