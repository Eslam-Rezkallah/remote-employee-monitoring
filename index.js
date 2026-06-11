import { config } from "./src/config/index.js";
import express from "express";
import bootstrap from "./src/App.controller.js";
import { runIo, getIo } from "./src/modules/socket/socket.controller.js";
import startOTPCleanerJob from "./src/utils/jobs/otp.cleaner.job.js";
import { startScheduledMessagesJob } from "./src/utils/jobs/scheduled-messages.job.js";
import { startRemindersJob } from "./src/utils/jobs/reminders.job.js";
import { startMeetingRemindersJob } from "./src/utils/jobs/meeting-reminders.job.js";
import { startWebhookDeliveryJob } from "./src/utils/jobs/webhook-delivery.job.js";
import { attachGracefulShutdown } from "./src/utils/shutdown/graceful.js";
import { logger } from "./src/utils/logger/logger.js";
import { initSentry } from "./src/utils/observability/sentry.js";
import { initSecrets } from "./src/utils/secrets/secrets.manager.js";

// Bootstrap order: secrets first (so other inits can read them),
// Sentry second (so it can capture errors thrown during bootstrap),
// then everything else.
await initSecrets();
await initSentry();

const app = express();

logger.info(
  { env: config.app.mood, name: config.app.name },
  "starting service",
);

await bootstrap(app, express);

const httpServer = app.listen(config.app.port, () => {
  logger.info({ port: config.app.port }, "http server listening");
});

runIo(httpServer);
startOTPCleanerJob();
startScheduledMessagesJob();
startRemindersJob();
startMeetingRemindersJob();
startWebhookDeliveryJob();

attachGracefulShutdown({ httpServer, io: getIo() });
