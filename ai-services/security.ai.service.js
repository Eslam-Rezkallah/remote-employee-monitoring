import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.join(__dirname, "security_ai_service.py");
const DEFAULT_MODEL = "python-security-v1";

function normalizeResult(result, fallbackReason) {
  return {
    aiUsed: Boolean(result?.aiUsed),
    aiModel: result?.aiModel || DEFAULT_MODEL,
    aiFallbackReason: result?.aiFallbackReason || fallbackReason || null,
    ...result,
  };
}

export function runPython(command, payload) {
  return new Promise((resolve) => {
    const py = spawn("python", [SCRIPT_PATH, command], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
      },
    });

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    py.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    py.on("close", () => {
      try {
        resolve(normalizeResult(JSON.parse(stdout || "{}"), stderr || null));
      } catch {
        resolve(
          normalizeResult(
            {},
            stderr || "Invalid response from Python security service",
          ),
        );
      }
    });

    py.on("error", (error) => {
      resolve(
        normalizeResult(
          {},
          error?.message || "Failed to start Python security service",
        ),
      );
    });

    py.stdin.write(JSON.stringify(payload || {}));
    py.stdin.end();
  });
}

export async function analyzeMessageSecurityAI(payload) {
  return runPython("message_guard", payload);
}

export async function analyzeFilesSecurityAI(payload) {
  return runPython("file_scan", payload);
}

export async function analyzeUrlsSecurityAI(payload) {
  return runPython("url_guard", payload);
}

export async function analyzeSecretsSecurityAI(payload) {
  return runPython("secret_scan", payload);
}

export async function assessLoginRiskAI(payload) {
  return runPython("login_risk", payload);
}

export async function detectBehaviorAnomalyAI(payload) {
  return runPython("behavior_anomaly", payload);
}

export async function adviseAccessControlAI(payload) {
  return runPython("access_advisor", payload);
}

export async function summarizeIncidentAI(payload) {
  return runPython("incident_summary", payload);
}

export async function analyzeLogsSecurityAI(payload) {
  return runPython("log_siem", payload);
}

export async function verifyIdentitySecurityAI(payload) {
  return runPython("identity_verify", payload);
}

export async function adviseEncryptionAI(payload) {
  return runPython("encryption_advisor", payload);
}

export async function detectFraudSecurityAI(payload) {
  return runPython("fraud_detect", payload);
}

export async function scoreUserRiskAI(payload) {
  return runPython("user_risk", payload);
}

export async function detectInsiderThreatAI(payload) {
  return runPython("user_risk", {
    ...payload,
    mode: "insider_threat",
  });
}

export async function detectEvilTwinWifiAI(payload) {
  return runPython("wifi_twin", payload);
}
