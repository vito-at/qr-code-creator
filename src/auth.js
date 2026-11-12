import crypto from "node:crypto";

const COOKIE = "dv_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sha = (s) => crypto.createHash("sha256").update(s).digest();
const sign = (secret, value) => crypto.createHmac("sha256", secret).update(value).digest("base64url");

export function passwordOk(given, expected) {
  return crypto.timingSafeEqual(sha(String(given ?? "")), sha(expected));
}

/** Подписанная cookie входа: «срок.подпись» — без хранения сессий на сервере */
export function makeSession(secret) {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${sign(secret, exp)}`;
}

export function sessionOk(secret, value) {
  if (typeof value !== "string") return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = Buffer.from(sign(secret, exp));
  const got = Buffer.from(sig);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function readCookie(req, name = COOKIE) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function cookieHeader(value, { secure, path, maxAgeSec }) {
  return [`${COOKIE}=${encodeURIComponent(value)}`, `Path=${path}`, "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSec}`, secure ? "Secure" : ""].filter(Boolean).join("; ");
}
export const SESSION_MAX_AGE = TTL_MS / 1000;

/** Защита от подбора пароля: не больше 10 неудачных попыток с одного адреса за 15 минут */
export function loginLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const fails = new Map();
  const fresh = (ip) => (fails.get(ip) ?? []).filter((t) => Date.now() - t < windowMs);
  return {
    blocked: (ip) => fresh(ip).length >= max,
    fail: (ip) => fails.set(ip, [...fresh(ip), Date.now()]),
    reset: (ip) => fails.delete(ip),
  };
}
