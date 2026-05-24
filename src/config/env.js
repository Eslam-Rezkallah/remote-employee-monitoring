import path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import joi from "joi";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Support both MOOD (current) and NODE_ENV (standard)
const mood = process.env.MOOD || "DEV";
const envFile = mood === "PROD" ? ".env.prod" : ".env.dev";

dotenv.config({ path: path.resolve(__dirname, envFile) });

// ── Validation schema ──────────────────────────────────────
const envSchema = joi
  .object({
    MOOD: joi.string().valid("DEV", "PROD").default("DEV"),
    APP_NAME: joi.string().required(),
    PORT: joi.number().port().default(3000),

    // Database
    DB_URI: joi
      .string()
      .uri({ scheme: ["mongodb", "mongodb+srv"] })
      .required(),

    // Security
    SALT: joi.number().integer().min(10).max(14).required(),
    ACCESS_TOKEN_EXPIRATION: joi.string().default("15m"),
    REFRESH_TOKEN_EXPIRATION: joi.string().default("7d"),

    USER_ACCESS_TOKEN: joi.string().min(32).required(),
    USER_REFRESH_TOKEN: joi.string().min(32).required(),
    ADMIN_ACCESS_TOKEN: joi.string().min(32).required(),
    ADMIN_REFRESH_TOKEN: joi.string().min(32).required(), // 15 min in seconds

    // Email
    EMAIL: joi.string().email().required(),
    EMAIL_PASSWORD: joi.string().required(),
    // inside envSchema
    REDIS_URL: joi
      .string()
      .uri({ scheme: ["redis", "rediss"] })
      .optional(),
    // Cloudinary
    CLOUDINARY_CLOUD_NAME: joi.string().required(),
    CLOUDINARY_API_KEY: joi.string().required(),
    CLOUDINARY_API_SECRET: joi.string().required(),

    // OAuth
    GOOGLE_CLIENT_ID: joi.string().required(),

    // AI (optional)
    OPENAI_API_KEY: joi.string().allow("").optional(),
    OPENAI_MODEL: joi.string().default("gpt-4o-mini"),

    // Frontend
    FRONTEND_URL: joi.string().uri().default("http://localhost:3000"),
  })
  .unknown(true);

const { error, value } = envSchema.validate(process.env, { abortEarly: false });

if (error) {
  console.error("❌ Invalid environment configuration:");
  error.details.forEach((d) => console.error(`  - ${d.message}`));
  process.exit(1);
}

export const env = value;
