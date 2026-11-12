import path from "node:path";

/** Настройки из переменных окружения (см. .env.example) */
export function loadConfig(env = process.env) {
  const baseUrl = (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, "");
  const adminPath = "/" + (env.ADMIN_PATH || "admin").replace(/^\/+|\/+$/g, "");
  if (!env.ADMIN_PASSWORD && !env.ADMIN_PASSWORD_HASH) throw new Error("Не задан ADMIN_PASSWORD (или ADMIN_PASSWORD_HASH)");
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET должен быть не короче 32 символов");
  if (!/^\/[\w-]+$/.test(adminPath)) throw new Error("ADMIN_PATH: только латиница, цифры, - и _");
  return {
    port: Number(env.PORT || 3000),
    baseUrl,
    adminPath,
    /** начальный пароль: хэш (npm run hash-password) или открытым текстом; после смены в админке действует новый */
    // «$$» → «$»: на случай, если хэш из docker-compose пришёл с неснятым экранированием (в хэше других «$$» не бывает)
    adminPassword: env.ADMIN_PASSWORD_HASH?.split("$$").join("$") || env.ADMIN_PASSWORD,
    /** не задан — создаётся сам и хранится в data/session-secret */
    sessionSecret: env.SESSION_SECRET || null,
    dataDir: path.resolve(env.DATA_DIR || "./data"),
    maxFileMb: Number(env.MAX_FILE_MB || 25),
    secureCookies: baseUrl.startsWith("https://"),
  };
}
