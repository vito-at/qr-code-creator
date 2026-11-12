// Хэш пароля для ADMIN_PASSWORD_HASH: npm run hash-password -- 'пароль'
import { hashPassword } from "./auth.js";

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error("Пароль не короче 10 символов: npm run hash-password -- 'пароль'");
  process.exit(1);
}
console.log(hashPassword(pw));
