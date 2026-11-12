import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { cookieHeader, loginLimiter, makeSession, passwordOk, readCookie, SESSION_MAX_AGE, sessionOk } from "./auth.js";
import { qrJpg, qrPng } from "./qr.js";
import { detectType } from "./store.js";
import { docPage, listPage, loginPage, notFoundPage, viewerPage } from "./views.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pdfjsDir = path.join(root, "node_modules/pdfjs-dist");

/** Сообщения после действий: в адресе только код, текст — отсюда */
const FLASH = {
  created: { kind: "ok", text: "Документ создан. Скачайте QR-код, вставьте его в файл и загрузите файл ниже." },
  uploaded: { kind: "ok", text: "Файл загружен. Теперь QR-код открывает этот файл." },
  renamed: { kind: "ok", text: "Название сохранено." },
  deleted: { kind: "ok", text: "Документ удалён." },
  badtype: { kind: "err", text: "Можно загрузить только PDF, JPG, PNG или WEBP." },
  toobig: { kind: "err", text: "Файл слишком большой." },
  nofile: { kind: "err", text: "Выберите файл." },
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
    next();
  });

  const cookieOpts = { secure: config.secureCookies, path: "/" };

  admin.post("/login", (req, res) => {
    if (limiter.blocked(req.ip)) return res.status(429).type("html").send(loginPage(A, "Слишком много попыток. Подождите 15 минут."));
    if (!passwordOk(req.body.password, config.adminPassword)) {
      limiter.fail(req.ip);
      return res.status(401).type("html").send(loginPage(A, "Неверный пароль"));
    }
    limiter.reset(req.ip);
    res.set("Set-Cookie", cookieHeader(makeSession(config.sessionSecret), { ...cookieOpts, maxAgeSec: SESSION_MAX_AGE })).redirect(303, A);
  });

  admin.use((req, res, next) => {
    if (sessionOk(config.sessionSecret, readCookie(req))) return next();
    if (req.method === "GET" && req.path === "/") return res.type("html").send(loginPage(A));
    res.redirect(303, A);
  });

  admin.post("/logout", (req, res) => res.set("Set-Cookie", cookieHeader("", { ...cookieOpts, maxAgeSec: 0 })).redirect(303, A));

  admin.get("/", (req, res) => res.type("html").send(listPage(A, store.list(), FLASH[req.query.m] ?? null)));

  admin.post("/docs", (req, res) => {
    const d = store.create(String(req.body.title ?? "").trim());
    res.redirect(303, `${A}/docs/${d.id}?m=created`);
  });

  const withDoc = (handler) => (req, res, next) => {
    const d = /^\d+$/.test(req.params.id) ? store.get(Number(req.params.id)) : null;
    if (!d) return res.status(404).type("html").send(listPage(A, store.list(), { kind: "err", text: "Документ не найден" }));
    return handler(req, res, d, next);
  };

  admin.get("/docs/:id", withDoc((req, res, d) => res.type("html").send(docPage(A, d, publicUrl(d), config.maxFileMb, FLASH[req.query.m] ?? null))));

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
