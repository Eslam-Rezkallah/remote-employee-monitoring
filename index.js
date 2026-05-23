// MUST be first — loads & validates env before anything else
import { config } from "./src/config/index.js";

import express from "express";
import bootstrap from "./src/App.controller.js";
import { runIo } from "./src/modules/socket/socket.controller.js";
import startOTPCleanerJob from "./src/utils/jobs/otp.cleaner.job.js";

const app = express();

console.log(`[${config.app.mood}] starting ${config.app.name}...`);

await bootstrap(app, express);

const httpServer = app.listen(config.app.port, () => {
  console.log(`app listening on port ${config.app.port}`);
});

runIo(httpServer);
startOTPCleanerJob();
