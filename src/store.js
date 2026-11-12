import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Хранилище: список документов в SQLite (data/docs.db), сами файлы — в data/files/<token>.
 * token — случайная часть адреса /d/<token>, его нельзя подобрать.
 */
export function openStore(dataDir) {
  const filesDir = path.join(dataDir, "files");
  fs.mkdirSync(filesDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "docs.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      token        TEXT NOT NULL UNIQUE,
      title        TEXT NOT NULL DEFAULT '',
      file_name    TEXT,
      mime         TEXT,
      size         INTEGER,
      uploaded_at  TEXT,
      created_at   TEXT NOT NULL,
      views        INTEGER NOT NULL DEFAULT 0,
      last_view_at TEXT
    );
  `);
  const now = () => new Date().toISOString();
  const filePath = (token) => path.join(filesDir, token);

  return {
    filePath,
    create(title) {
      const token = crypto.randomBytes(16).toString("base64url");
      const r = db.prepare("INSERT INTO docs (token, title, created_at) VALUES (?, ?, ?)").run(token, title.slice(0, 200), now());
      return this.get(Number(r.lastInsertRowid));
    },
    get(id) {
      return db.prepare("SELECT * FROM docs WHERE id = ?").get(id) ?? null;
    },
    byToken(token) {
      return db.prepare("SELECT * FROM docs WHERE token = ?").get(token) ?? null;
    },
    list() {
      return db.prepare("SELECT * FROM docs ORDER BY id DESC").all();
    },
    rename(id, title) {
      db.prepare("UPDATE docs SET title = ? WHERE id = ?").run(title.slice(0, 200), id);
    },
    /** Сохранить (или заменить) файл документа */
    saveFile(id, { buffer, fileName, mime }) {
      const doc = this.get(id);
      if (!doc) return null;
      const tmp = filePath(doc.token) + ".tmp";
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, filePath(doc.token));
      db.prepare("UPDATE docs SET file_name = ?, mime = ?, size = ?, uploaded_at = ? WHERE id = ?").run(fileName, mime, buffer.length, now(), id);
      return this.get(id);
    },
    remove(id) {
      const doc = this.get(id);
      if (!doc) return;
      fs.rmSync(filePath(doc.token), { force: true });
      db.prepare("DELETE FROM docs WHERE id = ?").run(id);
    },
    countView(id) {
      db.prepare("UPDATE docs SET views = views + 1, last_view_at = ? WHERE id = ?").run(now(), id);
    },
    close() {
      db.close();
    },
  };
}

/** Тип файла по первым байтам: принимаем только PDF и картинки */
export function detectType(buf) {
  const s = (a, b) => buf.subarray(a, b).toString("latin1");
  if (s(0, 5) === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (buf[0] === 0x89 && s(1, 4) === "PNG") return { mime: "image/png", ext: "png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}
