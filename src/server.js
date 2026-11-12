import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openStore } from "./store.js";

const config = loadConfig();
const store = openStore(config.dataDir);
const server = createApp(config, store).listen(config.port, () => {
  console.log(`Сайт проверки документов: ${config.baseUrl} (порт ${config.port}), админка: ${config.baseUrl}${config.adminPath}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => (store.close(), process.exit(0))));
}
