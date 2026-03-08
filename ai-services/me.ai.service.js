import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.join(__dirname, "me_ai_service.py");

function runPython(command, payload) {
  return new Promise((resolve) => {
    const py = spawn("python", [SCRIPT_PATH, command], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        OPENAI_MODEL: process.env.OPENAI_MODEL || "",
      },
    });

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    py.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    py.on("close", () => {
      try {
        const parsed = JSON.parse(stdout || "{}");
        resolve(parsed);
      } catch {
        resolve({
          aiUsed: false,
          aiModel: null,
          aiFallbackReason: stderr || "Invalid response from Python AI service",
        });
      }
    });

    py.on("error", (err) => {
      resolve({
        aiUsed: false,
        aiModel: null,
        aiFallbackReason: err?.message || "Failed to start Python AI service",
      });
    });

    py.stdin.write(JSON.stringify(payload || {}));
    py.stdin.end();
  });
}

export async function rerankForYouWithAI({ scored = [], limit = 15 }) {
  const result = await runPython("for_you", { scored, limit: Number(limit) });
  return {
    aiUsed: Boolean(result?.aiUsed),
    aiModel: result?.aiModel || null,
    aiFallbackReason: result?.aiFallbackReason || null,
    items: Array.isArray(result?.items) ? result.items : scored.slice(0, Number(limit)),
  };
}

export async function rerankForYouWithPythonAI({
  scored = [],
  limit = 15,
  userHistory = [],
  teamHistory = [],
}) {
  const result = await runPython("for_you_v2", {
    scored,
    limit: Number(limit),
    userHistory,
    teamHistory,
  });

  return {
    aiUsed: Boolean(result?.aiUsed),
    aiModel: result?.aiModel || "python-heuristic-v1",
    aiFallbackReason: result?.aiFallbackReason || null,
    items: Array.isArray(result?.items) ? result.items : scored.slice(0, Number(limit)),
  };
}

export async function annotateWorkedOnWithAI({ items = [] }) {
  const result = await runPython("worked_on", { items });
  const notes = Array.isArray(result?.notes) ? result.notes : [];

  const notesById = new Map();
  for (const n of notes) {
    if (!n?.id) continue;
    notesById.set(String(n.id), {
      aiScore: Number.isFinite(Number(n.score)) ? Number(n.score) : null,
      aiNote: typeof n.note === "string" ? n.note : null,
    });
  }

  return {
    aiUsed: Boolean(result?.aiUsed),
    aiModel: result?.aiModel || null,
    aiFallbackReason: result?.aiFallbackReason || null,
    notesById,
  };
}
