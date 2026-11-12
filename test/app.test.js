import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import jsQR from "jsqr";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openStore } from "../src/store.js";

const PASSWORD = "test-password";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-verify-"));
const config = loadConfig({ ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: "x".repeat(40), DATA_DIR: dir, BASE_URL: "https://check.example.com", ADMIN_PATH: "panel", MAX_FILE_MB: "1" });
const store = openStore(dir);
let server, base, cookie;

const req = (p, opts = {}) => fetch(base + p, { redirect: "manual", ...opts, headers: { ...(cookie ? { cookie } : {}), ...opts.headers } });
const form = (data) => ({ method: "POST", body: new URLSearchParams(data), headers: { "content-type": "application/x-www-form-urlencoded" } });
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");

function decode({ data, width, height }) {
  return jsQR(new Uint8ClampedArray(data), width, height)?.data;
}
async function uploadFile(id, buf, name) {
  const fd = new FormData();
  fd.append("file", new Blob([buf]), name);
  return req(`/panel/docs/${id}/file`, { method: "POST", body: fd });
}

before(async () => {
  server = createApp(config, store).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("вход", () => {
  it("без входа админка показывает только форму пароля", async () => {
    const r = await req("/panel");
    assert.equal(r.status, 200);
    assert.match(await r.text(), /type="password"/);
    assert.equal((await req("/panel/docs", form({ title: "x" }))).headers.get("location"), "/panel");
    assert.equal(store.list().length, 0);
  });
  it("неверный пароль — отказ", async () => {
    assert.equal((await req("/panel/login", form({ password: "nope" }))).status, 401);
  });
  it("верный пароль — cookie входа", async () => {
    const r = await req("/panel/login", form({ password: PASSWORD }));
    assert.equal(r.status, 303);
    cookie = r.headers.get("set-cookie").split(";")[0];
    assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    assert.match(r.headers.get("set-cookie"), /Secure/);
  });
  it("форма с чужого сайта отклоняется", async () => {
    const r = await req("/panel/docs", { ...form({ title: "x" }), headers: { ...form({}).headers, origin: "https://evil.example" } });
    assert.equal(r.status, 403);
  });
});

describe("документ", () => {
  let doc;
  it("«Создать» создаёт документ со случайным адресом", async () => {
    const r = await req("/panel/docs", form({ title: "Иванов <b>" }));
    assert.equal(r.status, 303);
    doc = store.list()[0];
    assert.match(doc.token, /^[\w-]{22}$/);
    const page = await (await req(r.headers.get("location"))).text();
    assert.match(page, /Иванов &lt;b&gt;/);
    assert.match(page, new RegExp(`https://check.example.com/d/${doc.token}`));
  });
  it("QR-код в PNG и JPG ведёт на страницу документа", async () => {
    const url = `https://check.example.com/d/${doc.token}`;
    const png = await req(`/panel/docs/${doc.id}/qr.png?download=1`);
    assert.equal(png.headers.get("content-type"), "image/png");
    assert.match(png.headers.get("content-disposition"), /attachment; filename="qr-\d+\.png"/);
    assert.equal(decode(PNG.sync.read(Buffer.from(await png.arrayBuffer()))), url);
    const jpg = await req(`/panel/docs/${doc.id}/qr.jpg?download=1`);
    assert.equal(jpg.headers.get("content-type"), "image/jpeg");
    assert.equal(decode(jpeg.decode(Buffer.from(await jpg.arrayBuffer()))), url);
  });
  it("QR-код без входа не скачать", async () => {
    const r = await fetch(`${base}/panel/docs/${doc.id}/qr.png`, { redirect: "manual" });
    assert.equal(r.status, 303);
  });
  it("пока файла нет, по QR-коду — «не найден»", async () => {
    assert.equal((await fetch(`${base}/d/${doc.token}`)).status, 404);
  });
  it("не PDF и не картинку загрузить нельзя", async () => {
    const r = await uploadFile(doc.id, Buffer.from("<html><script>alert(1)</script>"), "x.pdf");
    assert.match(r.headers.get("location"), /m=badtype/);
    assert.equal(store.get(doc.id).file_name, null);
  });
  it("слишком большой файл не загружается", async () => {
    const r = await uploadFile(doc.id, Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024)]), "big.pdf");
    assert.match(r.headers.get("location"), /m=toobig/);
  });
  it("PDF загружается, и страница проверяющего показывает только его", async () => {
    const r = await uploadFile(doc.id, PDF, "Бронь отеля.pdf");
    assert.match(r.headers.get("location"), /m=uploaded/);
    assert.equal(store.get(doc.id).file_name, "Бронь отеля.pdf");
    const v = await fetch(`${base}/d/${doc.token}`);
    assert.equal(v.status, 200);
    const html = await v.text();
    assert.doesNotMatch(html, /<a\s/i, "на странице нет ссылок");
    assert.doesNotMatch(html, /panel/);
    assert.match(v.headers.get("content-security-policy"), /form-action 'none'/);
    const f = await fetch(`${base}/f/${doc.token}`);
    assert.equal(f.headers.get("content-type"), "application/pdf");
    assert.deepEqual(Buffer.from(await f.arrayBuffer()), PDF);
    assert.equal(store.get(doc.id).views, 1);
  });
  it("картинку можно загрузить вместо PDF", async () => {
    const png = await (await req(`/panel/docs/${doc.id}/qr.png`)).arrayBuffer();
    await uploadFile(doc.id, Buffer.from(png), "scan.PNG");
    const html = await (await fetch(`${base}/d/${doc.token}`)).text();
    assert.match(html, /<img src="\/f\//);
    assert.doesNotMatch(html, /viewer\.js/);
  });
  it("удалённый документ больше не открывается", async () => {
    await req(`/panel/docs/${doc.id}/delete`, form({}));
    assert.equal((await fetch(`${base}/d/${doc.token}`)).status, 404);
    assert.equal(fs.existsSync(store.filePath(doc.token)), false);
  });
});

describe("остальные страницы для проверяющего закрыты", () => {
  for (const p of ["/", "/d/abc", "/d/%2e%2e%2fpanel", "/f/whatever", "/robots.txt", "/admin"]) {
    it(p, async () => {
      const r = await fetch(base + p, { redirect: "manual" });
      assert.equal(r.status, 404);
      assert.doesNotMatch(await r.text(), /<a\s/i);
    });
  }
});
