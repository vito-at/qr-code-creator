import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { cookieHeader, hashPassword, loginLimiter, makeSession, passwordOk, readCookie, SESSION_MAX_AGE, sessionKey, sessionOk } from "./auth.js";
import { qrJpg, qrPng } from "./qr.js";
import { LANG_COOKIE, LANGS, pickLang } from "./i18n.js";
import { detectType } from "./store.js";
import { docPage, listPage, loginPage, notFoundPage, passwordPage, viewerPage } from "./views.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pdfjsDir = path.join(root, "node_modules/pdfjs-dist");

/** Сообщения после действий: в адресе только код (?m=…), текст — из i18n.js (flash.*) */
const FLASH = {
  created: "ok", uploaded: "ok", renamed: "ok", deleted: "ok", passwordChanged: "ok",
  badtype: "err", toobig: "err", nofile: "err", notfound: "err", wrongCurrent: "err", pwShort: "err", pwMismatch: "err",
};

const ADMIN_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Cache-Control": "no-store",
  // с no-referrer браузер присылает в формах Origin: null, и проверка ниже не работает
  "Referrer-Policy": "same-origin",
};
const VIEWER_CSP =
  "default-src 'none'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data: blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function createApp(config, store) {
  const app = express();
  const A = config.adminPath;
  const limiter = loginLimiter();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileMb * 1024 * 1024, files: 1 } });
  const publicUrl = (d) => `${config.baseUrl}/d/${d.token}`;
  const secret = config.sessionSecret ?? store.sessionSecret();
  // действующий пароль: заданный в админке, иначе — из настроек
  const currentPassword = () => store.adminPasswordHash() ?? config.adminPassword;
  const key = () => sessionKey(secret, currentPassword());

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "X-Robots-Tag": "noindex, nofollow" });
    next();
  });

  // ---------- статика ----------
  const staticOpts = { index: false, fallthrough: false, maxAge: "1d" };
  app.use("/static/pdfjs/cmaps", express.static(path.join(pdfjsDir, "cmaps"), staticOpts));
  app.use("/static/pdfjs/standard_fonts", express.static(path.join(pdfjsDir, "standard_fonts"), staticOpts));
  for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
    app.get(`/static/pdfjs/${f}`, (req, res) => res.type("text/javascript").set("Cache-Control", "public, max-age=86400").sendFile(path.join(pdfjsDir, "legacy/build", f)));
  }
  app.use("/static", express.static(path.join(root, "public"), staticOpts));

  // ---------- страница для проверяющего ----------
  const TOKEN = /^[\w-]{22}$/;
  const ready = (token) => {
    if (!TOKEN.test(token)) return null;
    const d = store.byToken(token);
    return d?.file_name && fs.existsSync(store.filePath(d.token)) ? d : null;
  };

  app.get("/d/:token", (req, res) => {
    const d = ready(req.params.token);
    res.set({ "Content-Security-Policy": VIEWER_CSP, "Cache-Control": "no-store" });
    if (!d) return res.status(404).type("html").send(notFoundPage());
    if (!readCookie(req)) store.countView(d.id); // свои открытия из админки не считаем
    res.type("html").send(viewerPage(d.token, d.mime));
  });

  app.get("/f/:token", (req, res) => {
    const d = ready(req.params.token);
    if (!d) return res.status(404).type("html").set("Content-Security-Policy", VIEWER_CSP).send(notFoundPage());
    res.set({
      "Content-Type": d.mime,
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(d.file_name)}`,
    });
    // картинка открывается отдельно — без скриптов; PDF показывает встроенный просмотрщик браузера
    if (d.mime !== "application/pdf") res.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.sendFile(store.filePath(d.token));
  });

  // ---------- админка ----------
  const admin = express.Router();
  admin.use(express.urlencoded({ extended: false, limit: "10kb" }));
  admin.use((req, res, next) => {
    res.set(ADMIN_HEADERS);
    // форму можно отправить только со своего сайта
    if (req.method === "POST") {
      const origin = req.get("origin") || req.get("referer");
      if (origin && URL.parse(origin)?.host !== req.get("host")) return res.status(403).send("Forbidden");
    }
    const flashKey = Object.hasOwn(FLASH, req.query.m) ? req.query.m : null;
    req.ctx = { a: A, lang: pickLang(readCookie(req, LANG_COOKIE), req.get("accept-language")), loggedIn: false, flash: flashKey && { kind: FLASH[flashKey], key: flashKey } };
    next();
  });

  // переключатель языка (доступен и до входа): запоминаем выбор и возвращаемся на ту же страницу админки
  admin.get("/lang/:lang", (req, res) => {
    const lang = LANGS.includes(req.params.lang) ? req.params.lang : "uz";
    const ref = URL.parse(req.get("referer") ?? "");
    const back = ref && ref.host === req.get("host") && (ref.pathname === A || ref.pathname.startsWith(`${A}/`)) ? ref.pathname : A;
    res.set("Set-Cookie", `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${config.secureCookies ? "; Secure" : ""}`).redirect(303, back);
  });

  const cookieOpts = { secure: config.secureCookies, path: "/" };

  admin.post("/login", (req, res) => {
    if (limiter.blocked(req.ip)) return res.status(429).type("html").send(loginPage(req.ctx, "tooManyAttempts"));
    if (!passwordOk(req.body.password, currentPassword())) {
      limiter.fail(req.ip);
      return res.status(401).type("html").send(loginPage(req.ctx, "wrongPassword"));
    }
    limiter.reset(req.ip);
    res.set("Set-Cookie", cookieHeader(makeSession(key()), { ...cookieOpts, maxAgeSec: SESSION_MAX_AGE })).redirect(303, A);
  });

  admin.use((req, res, next) => {
    if (sessionOk(key(), readCookie(req))) {
      req.ctx.loggedIn = true;
      return next();
    }
    if (req.method === "GET" && req.path === "/") return res.type("html").send(loginPage(req.ctx));
    res.redirect(303, A);
  });

  admin.post("/logout", (req, res) => res.set("Set-Cookie", cookieHeader("", { ...cookieOpts, maxAgeSec: 0 })).redirect(303, A));

  admin.get("/password", (req, res) => res.type("html").send(passwordPage(req.ctx)));
  admin.post("/password", (req, res) => {
    const back = (m) => res.redirect(303, `${A}/password?m=${m}`);
    if (limiter.blocked(req.ip)) return back("wrongCurrent");
    if (!passwordOk(req.body.current, currentPassword())) {
      limiter.fail(req.ip);
      return back("wrongCurrent");
    }
    const next = String(req.body.password ?? "");
    if (next.length < 10) return back("pwShort");
    if (next !== req.body.repeat) return back("pwMismatch");
    store.setAdminPasswordHash(hashPassword(next));
    // все остальные входы закрываются, текущему сотруднику выдаём новый
    res.set("Set-Cookie", cookieHeader(makeSession(key()), { ...cookieOpts, maxAgeSec: SESSION_MAX_AGE })).redirect(303, `${A}?m=passwordChanged`);
  });

  admin.get("/", (req, res) => res.type("html").send(listPage(req.ctx, store.list())));

  admin.post("/docs", (req, res) => {
    const d = store.create(String(req.body.title ?? "").trim());
    res.redirect(303, `${A}/docs/${d.id}?m=created`);
  });

  const withDoc = (handler) => (req, res, next) => {
    const d = /^\d+$/.test(req.params.id) ? store.get(Number(req.params.id)) : null;
    if (!d) return res.status(404).type("html").send(listPage({ ...req.ctx, flash: { kind: "err", key: "notfound" } }, store.list()));
    return handler(req, res, d, next);
  };

  admin.get("/docs/:id", withDoc((req, res, d) => res.type("html").send(docPage(req.ctx, d, publicUrl(d), config.maxFileMb))));

  const qrSize = (req) => Math.min(3000, Math.max(200, Number(req.query.size) || 1200));
  const dl = (req, res, d, ext) => {
    if (req.query.download) res.set("Content-Disposition", `attachment; filename="qr-${d.id}.${ext}"`);
  };
  admin.get("/docs/:id/qr.png", withDoc(async (req, res, d) => {
    dl(req, res, d, "png");
    res.type("png").send(await qrPng(publicUrl(d), qrSize(req)));
  }));
  admin.get("/docs/:id/qr.jpg", withDoc((req, res, d) => {
    dl(req, res, d, "jpg");
    res.type("jpeg").send(qrJpg(publicUrl(d), qrSize(req)));
  }));

  admin.post("/docs/:id/title", withDoc((req, res, d) => {
    store.rename(d.id, String(req.body.title ?? "").trim());
    res.redirect(303, `${A}/docs/${d.id}?m=renamed`);
  }));

  admin.post("/docs/:id/file", withDoc((req, res, d) => {
    upload.single("file")(req, res, (err) => {
      const back = (m) => res.redirect(303, `${A}/docs/${d.id}?m=${m}`);
      if (err) return back(err.code === "LIMIT_FILE_SIZE" ? "toobig" : "nofile");
      if (!req.file?.size) return back("nofile");
      const type = detectType(req.file.buffer);
      if (!type) return back("badtype");
      const base = path.parse(Buffer.from(req.file.originalname, "latin1").toString("utf8")).name.replace(/[\r\n"\\/]/g, "").slice(0, 150) || "document";
      store.saveFile(d.id, { buffer: req.file.buffer, fileName: `${base}.${type.ext}`, mime: type.mime });
      back("uploaded");
    });
  }));

  admin.post("/docs/:id/delete", withDoc((req, res, d) => {
    store.remove(d.id);
    res.redirect(303, `${A}?m=deleted`);
  }));

  app.use(A, admin);

  // всё остальное (в том числе главная) — «не найдено», без ссылок куда-либо
  app.use((req, res) => res.status(404).type("html").set("Content-Security-Policy", VIEWER_CSP).send(notFoundPage()));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.status !== 404) console.error(err);
    res.status(err.status === 404 ? 404 : 500).type("html").set("Content-Security-Policy", VIEWER_CSP).send(notFoundPage());
  });
  return app;
}
