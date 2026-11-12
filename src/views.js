/** HTML-страницы. Всё, что пришло от пользователя, проходит через esc() */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);

function adminLayout(title, body, { a, flash } = {}) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<link rel="stylesheet" href="/static/admin.css"></head>
<body><header class="top"><a href="${a}" class="brand">Проверка документов</a>${
    flash !== undefined ? `<form method="post" action="${a}/logout"><button class="link">Выйти</button></form>` : ""
  }</header>
<main>${flash ? `<p class="flash ${flash.kind}">${esc(flash.text)}</p>` : ""}${body}</main>
<script src="/static/admin.js"></script></body></html>`;
}

export function loginPage(a, error) {
  return adminLayout(
    "Вход",
    `<form method="post" action="${a}/login" class="card narrow">
      <h1>Вход</h1>
      ${error ? `<p class="flash err">${esc(error)}</p>` : ""}
      <label>Пароль<input type="password" name="password" autocomplete="current-password" required autofocus></label>
      <button class="btn primary">Войти</button>
    </form>`,
    { a },
  );
}

export function listPage(a, docs, flash) {
  const rows = docs
    .map(
      (d) => `<tr>
        <td><a href="${a}/docs/${d.id}">${esc(d.title || `Документ №${d.id}`)}</a></td>
        <td>${d.file_name ? `<span class="ok">Загружен</span>` : `<span class="muted">Ждёт файл</span>`}</td>
        <td class="num">${d.views}</td>
        <td>${fmtDate(d.created_at)}</td>
      </tr>`,
    )
    .join("");
  return adminLayout(
    "Документы",
    `<form method="post" action="${a}/docs" class="card create">
      <h1>Новый документ</h1>
      <p class="muted">Нажмите «Создать» — появится QR-код. Скачайте его, вставьте в документ и загрузите готовый файл на странице документа.</p>
      <div class="row">
        <input name="title" maxlength="200" placeholder="Название для себя (необязательно): например, «Иванов — бронь отеля»">
        <button class="btn primary">Создать</button>
      </div>
    </form>
    <section class="card">
      <h2>Все документы</h2>
      ${
        docs.length
          ? `<div class="scroll"><table><thead><tr><th>Название</th><th>Файл</th><th class="num">Просмотры</th><th>Создан</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : `<p class="muted">Пока нет документов.</p>`
      }
    </section>`,
    { a, flash },
  );
}

export function docPage(a, d, publicUrl, maxFileMb, flash) {
  const base = `${a}/docs/${d.id}`;
  return adminLayout(
    d.title || `Документ №${d.id}`,
    `<p><a href="${a}">← Все документы</a></p>
    <section class="card">
      <form method="post" action="${base}/title" class="row">
        <input name="title" value="${esc(d.title)}" maxlength="200" placeholder="Название для себя">
        <button class="btn">Сохранить название</button>
      </form>
    </section>
    <div class="grid">
      <section class="card">
        <h2>1. QR-код</h2>
        <img src="${base}/qr.png?size=600" alt="QR-код" class="qr" width="300" height="300">
        <div class="row">
          <a class="btn primary" href="${base}/qr.png?download=1">Скачать PNG</a>
          <a class="btn primary" href="${base}/qr.jpg?download=1">Скачать JPG</a>
        </div>
        <p class="muted small">Код ведёт на адрес:</p>
        <div class="row"><input readonly value="${esc(publicUrl)}" id="url"><button class="btn" type="button" data-copy="url">Копировать</button></div>
      </section>
      <section class="card">
        <h2>2. Файл с QR-кодом</h2>
        ${
          d.file_name
            ? `<p><span class="ok">Загружен:</span> ${esc(d.file_name)} · ${fmtSize(d.size)} · ${fmtDate(d.uploaded_at)}</p>
               <p><a class="btn" href="${publicUrl}" target="_blank" rel="noopener">Открыть как проверяющий</a></p>
               <p class="muted small">Просмотров по QR-коду: ${d.views}${d.last_view_at ? `, последний — ${fmtDate(d.last_view_at)}` : ""}</p>`
            : `<p class="muted">Файл ещё не загружен. Пока его нет, по QR-коду открывается «Документ не найден».</p>`
        }
        <form method="post" action="${base}/file" enctype="multipart/form-data" class="upload">
          <label>${d.file_name ? "Заменить файл" : "Загрузить файл"} (PDF, JPG, PNG, WEBP, до ${maxFileMb} МБ)
            <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required></label>
          <button class="btn primary">${d.file_name ? "Заменить" : "Загрузить"}</button>
        </form>
      </section>
    </div>
    <form method="post" action="${base}/delete" class="danger" data-confirm="Удалить документ? QR-код перестанет работать, это нельзя отменить.">
      <button class="btn danger">Удалить документ</button>
    </form>`,
    { a, flash },
  );
}

/** Страница для проверяющего: только файл, ни одной ссылки на другие страницы */
export function viewerPage(token, mime) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>Document</title>
<link rel="stylesheet" href="/static/viewer.css"></head>
<body><main id="doc" data-src="/f/${esc(token)}" data-type="${mime === "application/pdf" ? "pdf" : "image"}">
${mime === "application/pdf" ? `<p class="status" id="status">Загрузка… / Loading…</p>` : `<img src="/f/${esc(token)}" alt="">`}
</main>${mime === "application/pdf" ? `<script type="module" src="/static/viewer.js"></script>` : ""}</body></html>`;
}

export function notFoundPage() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>404</title>
<link rel="stylesheet" href="/static/viewer.css"></head>
<body><p class="status">Документ не найден<br>Document not found</p></body></html>`;
}
