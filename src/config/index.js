// src/config/index.js
import { env } from "./env.js";

/**
 * Centralized config.
 * NEVER read process.env directly outside this file.
 */
export const config = Object.freeze({
  app: {
    name: env.APP_NAME,
    mood: env.MOOD,
    port: env.PORT,
    isProd: env.MOOD === "PROD",
    isDev: env.MOOD === "DEV",
    frontendUrl: env.FRONTEND_URL,
  },
  db: {
    uri: env.DB_URI,
  },
  security: {
    saltRounds: env.SALT,
    userAccessSecret: env.USER_ACCESS_TOKEN,
    userRefreshSecret: env.USER_REFRESH_TOKEN,
    adminAccessSecret: env.ADMIN_ACCESS_TOKEN,
    adminRefreshSecret: env.ADMIN_REFRESH_TOKEN,
    accessTokenExpiration: env.ACCESS_TOKEN_EXPIRATION,
    refreshTokenExpiration: env.REFRESH_TOKEN_EXPIRATION,
  },
  email: {
    user: env.EMAIL,
    password: env.EMAIL_PASSWORD,
  },
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
  },
  oauth: {
    googleClientId: env.GOOGLE_CLIENT_ID,
  },
  ai: {
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
  },
  // NEW: Redis config (Phase 2 will use)
  redis: {
    url: env.REDIS_URL || null,
    enabled: Boolean(env.REDIS_URL),
  },
});
