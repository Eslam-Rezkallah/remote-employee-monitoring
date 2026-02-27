import bootstrap from "./src/App.controller.js";
import path from "path";
import express from "express";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve("./src/config/.env.dev") });
const app = express();
const port = process.env.PORT;

bootstrap(app, express);
const httpServer = app.listen(port, () =>
  console.log(`app listening on port ${port}`),
);

