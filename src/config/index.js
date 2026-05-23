import { env } from "./env.js";

/**
 * Centralized config.
 * Always import from here — NEVER read process.env directly in app code.
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
    security: {
      saltRounds: env.SALT,
      userAccessSecret: env.USER_ACCESS_TOKEN,
      userRefreshSecret: env.USER_REFRESH_TOKEN,
      adminAccessSecret: env.ADMIN_ACCESS_TOKEN,
      adminRefreshSecret: env.ADMIN_REFRESH_TOKEN,
      accessTokenExpiration: env.ACCESS_TOKEN_EXPIRATION, // "15m"
      refreshTokenExpiration: env.REFRESH_TOKEN_EXPIRATION, // "7d"
    },
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
});
