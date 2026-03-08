import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import * as dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env files relative to this index.js location (not process cwd).
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "src", "config", ".env.dev") });

const { default: bootstrap } = await import("./src/App.controller.js");
const { runIo } = await import("./src/modules/socket/socket.controller.js");

const app = express();
const port = process.env.PORT;

bootstrap(app, express);
const httpServer = app.listen(port, () =>
  console.log(`app listening on port ${port}`),
);

runIo(httpServer);

