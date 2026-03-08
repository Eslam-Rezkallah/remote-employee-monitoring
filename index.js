import bootstrap from "./src/app.controller.js";
import path from "path";
import express from "express";
import * as dotenv from "dotenv";

import { runIo } from "./src/modules/socket/socket.controller.js";
import startOTPCleanerJob from "./src/utils/jobs/otp.cleaner.job.js";
startOTPCleanerJob();
dotenv.config({ path: path.resolve("./src/config/.env.prod") });
const app = express();
const port = process.env.PORT || 8000;
console.log("MOOD =", process.env.MOOD);

bootstrap(app, express);

const chatRouter = (await import("./src/modules/chatroom/chat.controller.js"))
  .default;
app.use("/chat", chatRouter);

const httpServer = app.listen(port, () =>
  console.log(`app listening on port ${port}`),
);
runIo(httpServer);
