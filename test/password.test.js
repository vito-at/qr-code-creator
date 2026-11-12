import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashPassword, passwordOk } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openStore } from "../src/store.js";

const START = "start-password-123";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-verify-pw-"));
// как на сервере CRM: только хэш пароля, SESSION_SECRET не задан
const config = loadConfig({ ADMIN_PASSWORD_HASH: hashPassword(START), DATA_DIR: dir, BASE_URL: "https://check.example.com" });
const store = openStore(dir);
let server, base;

const post = (p, data, cookie) =>
  fetch(base + p, { method: "POST", redirect: "manual", body: new URLSearchParams(data), headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) } });
const login = async (password) => {
  const r = await post("/admin/login", { password });
  return r.status === 303 ? r.headers.get("set-cookie").split(";")[0] : null;
};
const loggedIn = async (cookie) => !/type="password"/.test(await (await fetch(`${base}/admin`, { headers: { cookie } })).text());

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

describe("пароль", () => {
  it("хэш проверяется, неверный пароль не подходит", () => {
    const h = hashPassword("abcdefghij");
    assert.match(h, /^scrypt\$/);
    assert.equal(passwordOk("abcdefghij", h), true);
    assert.equal(passwordOk("abcdefghiJ", h), false);
    assert.equal(passwordOk("plain-pass", "plain-pass"), true);
  });
  it("секрет входа создаётся сам и сохраняется", () => {
    const s = fs.readFileSync(path.join(dir, "session-secret"), "utf8");
    assert.match(s, /^[0-9a-f]{64}$/);
    assert.equal(store.sessionSecret(), s);
  });
  it("смена пароля: старый перестаёт подходить, остальные входы закрываются", async () => {
    const a = await login(START);
    const b = await login(START);
    assert.ok(a && b && (await loggedIn(a)) && (await loggedIn(b)));

    assert.match((await post("/admin/password", { current: "wrong", password: "new-password-1", repeat: "new-password-1" }, a)).headers.get("location"), /wrongCurrent/);
    assert.match((await post("/admin/password", { current: START, password: "short", repeat: "short" }, a)).headers.get("location"), /pwShort/);
    assert.match((await post("/admin/password", { current: START, password: "new-password-1", repeat: "new-password-2" }, a)).headers.get("location"), /pwMismatch/);

    const r = await post("/admin/password", { current: START, password: "new-password-1", repeat: "new-password-1" }, a);
    assert.match(r.headers.get("location"), /passwordChanged/);
    const a2 = r.headers.get("set-cookie").split(";")[0];
    assert.equal(await loggedIn(a2), true, "сменивший пароль остаётся в админке");
    assert.equal(await loggedIn(b), false, "другой вход закрыт");
    assert.equal(await login(START), null);
    assert.ok(await login("new-password-1"));
  });
  it("без входа сменить пароль нельзя", async () => {
    const r = await post("/admin/password", { current: "new-password-1", password: "hacked-password", repeat: "hacked-password" });
    assert.equal(r.headers.get("location"), "/admin");
    assert.ok(await login("new-password-1"));
  });
});

describe("хэш из docker-compose", () => {
  it("«$$» в хэше понимается как «$»", () => {
    const h = hashPassword("compose-pass-1");
    const c = loadConfig({ ADMIN_PASSWORD_HASH: h.replaceAll("$", "$$"), DATA_DIR: dir });
    assert.equal(c.adminPassword, h);
    assert.equal(passwordOk("compose-pass-1", c.adminPassword), true);
  });
});
