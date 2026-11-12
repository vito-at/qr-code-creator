import { LANGS, makeT, MESSAGES } from "./i18n.js";

/** HTML-страницы. Всё, что пришло от пользователя, проходит через esc() */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pad = (n) => String(n).padStart(2, "0");
/** Дата по Ташкенту (UTC+5, без перехода на летнее время): 12.11.2026, 15:27 */
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 5 * 3600 * 1000);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const fmtSize = (b, t) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} ${t("mb")}` : `${Math.max(1, Math.round(b / 1024))} ${t("kb")}`);

/**
 * ctx — { a: адрес админки, lang, loggedIn, flash: { kind, key } | null }
 */
function adminLayout(ctx, title, body) {
  const t = makeT(ctx.lang);
  const switcher = LANGS.map((l) =>
    l === ctx.lang ? `<span class="lang-on">${MESSAGES[l].langName}</span>` : `<a href="${ctx.a}/lang/${l}" lang="${l}">${MESSAGES[l].langName}</a>`,
  ).join("");
  return `<!doctype html>
<html lang="${ctx.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<link rel="stylesheet" href="/static/admin.css"></head>
<body><header class="top"><a href="${ctx.a}" class="brand">${t("appName")}</a>
<div class="top-right"><nav class="langs">${switcher}</nav>${
    ctx.loggedIn ? `<a href="${ctx.a}/password">${t("passwordMenu")}</a><form method="post" action="${ctx.a}/logout"><button class="link">${t("logout")}</button></form>` : ""
  }</div></header>
<main>${ctx.flash ? `<p class="flash ${ctx.flash.kind}">${esc(t(`flash.${ctx.flash.key}`))}</p>` : ""}${body}</main>
<script src="/static/admin.js"></script></body></html>`;
}

export function loginPage(ctx, errorKey) {
  const t = makeT(ctx.lang);
  return adminLayout(
    ctx,
    t("login"),
    `<form method="post" action="${ctx.a}/login" class="card narrow">
      <h1>${t("login")}</h1>
      ${errorKey ? `<p class="flash err">${esc(t(errorKey))}</p>` : ""}
      <label>${t("password")}<input type="password" name="password" autocomplete="current-password" required autofocus></label>
      <button class="btn primary">${t("signIn")}</button>
    </form>`,
  );
}

export function passwordPage(ctx) {
  const t = makeT(ctx.lang);
  return adminLayout(
    ctx,
    t("changePassword"),
    `<p><a href="${ctx.a}">${t("back")}</a></p>
    <form method="post" action="${ctx.a}/password" class="card narrow">
      <h1>${t("changePassword")}</h1>
      <p class="muted small">${t("changePasswordHint")}</p>
      <label>${t("currentPassword")}<input type="password" name="current" autocomplete="current-password" required></label>
      <label>${t("newPassword")}<input type="password" name="password" autocomplete="new-password" minlength="10" required></label>
      <label>${t("repeatPassword")}<input type="password" name="repeat" autocomplete="new-password" minlength="10" required></label>
      <button class="btn primary">${t("savePassword")}</button>
    </form>`,
  );
}

export function listPage(ctx, docs) {
  const t = makeT(ctx.lang);
  const a = ctx.a;
  const rows = docs
    .map(
      (d) => `<tr>
        <td><a href="${a}/docs/${d.id}">${esc(d.title || t("docN", { n: d.id }))}</a></td>
        <td>${d.file_name ? `<span class="ok">${t("fileReady")}</span>` : `<span class="muted">${t("fileWaiting")}</span>`}</td>
        <td class="num">${d.views}</td>
        <td>${fmtDate(d.created_at)}</td>
      </tr>`,
    )
    .join("");
  return adminLayout(
    ctx,
    t("documents"),
    `<form method="post" action="${a}/docs" class="card create">
      <h1>${t("newDoc")}</h1>
      <p class="muted">${t("newDocHint")}</p>
      <div class="row">
        <input name="title" maxlength="200" placeholder="${esc(t("titlePlaceholder"))}">
        <button class="btn primary">${t("create")}</button>
      </div>
    </form>
    <section class="card">
      <h2>${t("allDocs")}</h2>
      ${
        docs.length
          ? `<div class="scroll"><table><thead><tr><th>${t("colTitle")}</th><th>${t("colFile")}</th><th class="num">${t("colViews")}</th><th>${t("colCreated")}</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : `<p class="muted">${t("noDocs")}</p>`
      }
    </section>`,
  );
}

export function docPage(ctx, d, publicUrl, maxFileMb) {
  const t = makeT(ctx.lang);
  const base = `${ctx.a}/docs/${d.id}`;
  return adminLayout(
    ctx,
    d.title || t("docN", { n: d.id }),
    `<p><a href="${ctx.a}">${t("back")}</a></p>
    <section class="card">
      <form method="post" action="${base}/title" class="row">
        <input name="title" value="${esc(d.title)}" maxlength="200" placeholder="${esc(t("titleShort"))}">
        <button class="btn">${t("saveTitle")}</button>
      </form>
    </section>
    <div class="grid">
      <section class="card">
        <h2>${t("qrHeading")}</h2>
        <img src="${base}/qr.png?size=600" alt="${t("qrAlt")}" class="qr" width="300" height="300">
        <div class="row">
          <a class="btn primary" href="${base}/qr.png?download=1">${t("downloadPng")}</a>
          <a class="btn primary" href="${base}/qr.jpg?download=1">${t("downloadJpg")}</a>
        </div>
        <p class="muted small">${t("qrLeadsTo")}</p>
        <div class="row"><input readonly value="${esc(publicUrl)}" id="url"><button class="btn" type="button" data-copy="url" data-done="${esc(t("copied"))}">${t("copy")}</button></div>
      </section>
      <section class="card">
        <h2>${t("fileHeading")}</h2>
        ${
          d.file_name
            ? `<p><span class="ok">${t("uploadedInfo")}</span> ${esc(d.file_name)} · ${fmtSize(d.size, t)} · ${fmtDate(d.uploaded_at)}</p>
               <p><a class="btn" href="${esc(publicUrl)}" target="_blank" rel="noopener">${t("openAsInspector")}</a></p>
               <p class="muted small">${t("views", { n: d.views })}${d.last_view_at ? t("lastView", { date: fmtDate(d.last_view_at) }) : ""}</p>`
            : `<p class="muted">${t("noFileYet")}</p>`
        }
        <form method="post" action="${base}/file" enctype="multipart/form-data" class="upload">
          <label>${d.file_name ? t("replaceFile") : t("uploadFile")} ${t("fileTypes", { mb: maxFileMb })}
            <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required></label>
          <button class="btn primary">${d.file_name ? t("replace") : t("upload")}</button>
        </form>
      </section>
    </div>
    <form method="post" action="${base}/delete" class="danger" data-confirm="${esc(t("deleteConfirm"))}">
      <button class="btn danger">${t("deleteDoc")}</button>
    </form>`,
  );
}

/** Страница для проверяющего: только файл, ни одной ссылки на другие страницы. Служебные надписи — сразу на трёх языках */
export function viewerPage(token, mime) {
  const pdf = mime === "application/pdf";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>Hujjat · Документ · Document</title>
<link rel="stylesheet" href="/static/viewer.css"></head>
<body><main id="doc" data-src="/f/${esc(token)}">
${pdf ? `<p class="status" id="status">Yuklanmoqda… / Загрузка… / Loading…</p>` : `<img src="/f/${esc(token)}" alt="">`}
</main>${pdf ? `<script type="module" src="/static/viewer.js"></script>` : ""}</body></html>`;
}

export function notFoundPage() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>404</title>
<link rel="stylesheet" href="/static/viewer.css"></head>
<body><p class="status">Hujjat topilmadi<br>Документ не найден<br>Document not found</p></body></html>`;
}
