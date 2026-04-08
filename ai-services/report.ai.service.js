import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.join(__dirname, "report_ai_service.py");
const DEFAULT_MODEL = "python-report-v1";

function normalizeResult(result, fallbackReason) {
  return {
    aiUsed: Boolean(result?.aiUsed),
    aiModel: result?.aiModel || DEFAULT_MODEL,
    aiFallbackReason: result?.aiFallbackReason || fallbackReason || null,
    ...result,
  };
}

function runPython(command, payload) {
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
            stderr || "Invalid response from Python report service",
          ),
        );
      }
    });

    py.on("error", (error) => {
      resolve(
        normalizeResult(
          {},
          error?.message || "Failed to start Python report service",
        ),
      );
    });

    py.stdin.write(JSON.stringify(payload || {}));
    py.stdin.end();
  });
}

export async function analyzeReportFileAI(payload) {
  return runPython("analyze_report", payload);
}
