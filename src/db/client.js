const { getLogger } = require("../observability/logger");
const log = getLogger("db.client");
const adapter = String(process.env.DB_ADAPTER || "mysql").toLowerCase();
if (adapter !== "mysql") throw new Error(`[db/client] Unsupported DB_ADAPTER="${adapter}". This backend is MySQL-only.`);
if (!process.env.MYSQL_URL && !process.env.MYSQL_HOST) throw new Error("[db/client] MySQL configuration is required");
log.info("🗄️ DB adapter: mysql");
module.exports = require("./adapters/mysql");
