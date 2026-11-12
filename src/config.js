import path from "node:path";

/** Настройки из переменных окружения (см. .env.example) */
export function loadConfig(env = process.env) {
  const baseUrl = (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, "");
  const adminPath = "/" + (env.ADMIN_PATH || "admin").replace(/^\/+|\/+$/g, "");
  if (!env.ADMIN_PASSWORD) throw new Error("Не задан ADMIN_PASSWORD");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET должен быть не короче 32 символов");
  if (!/^\/[\w-]+$/.test(adminPath)) throw new Error("ADMIN_PATH: только латиница, цифры, - и _");
  return {
    port: Number(env.PORT || 3000),
    baseUrl,
    adminPath,
    adminPassword: env.ADMIN_PASSWORD,
    sessionSecret: env.SESSION_SECRET,
    dataDir: path.resolve(env.DATA_DIR || "./data"),
    maxFileMb: Number(env.MAX_FILE_MB || 25),
    secureCookies: baseUrl.startsWith("https://"),
  };
}
