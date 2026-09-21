require("dotenv").config();

const mysql = require("mysql2/promise");
const { encryptJson } = require("../src/security/channelCredentials");

const SECRET_KEYS = ["accessToken", "appSecret", "verifyToken", "authToken", "authId"];

function mysqlConfig() {
  if (process.env.MYSQL_URL) return process.env.MYSQL_URL;
  const required = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"];
  for (const key of required) {
    if (process.env[key] === undefined || process.env[key] === "") throw new Error(`${key} is required when MYSQL_URL is not set`);
  }
  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  };
}

function isExpectedAlreadyExistsError(err) {
  return err?.code === "ER_DUP_FIELDNAME";
}

async function main() {
  if (!process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY) {
    throw new Error("CHANNEL_CREDENTIALS_ENCRYPTION_KEY is required");
  }

  const pool = mysql.createPool(mysqlConfig());


  try {
    try {
      await pool.query("ALTER TABLE channels ADD COLUMN credentials_encrypted TEXT");
    } catch (err) {
      if (!isExpectedAlreadyExistsError(err)) throw err;
    }
    const { rows } = await pool.query(
      "SELECT id, config FROM channels WHERE credentials_encrypted IS NULL"
    );

    let migrated = 0;
    for (const row of rows) {
      const config = row.config && typeof row.config === "object" ? { ...row.config } : {};
      const credentials = {};
      let changed = false;

      for (const key of SECRET_KEYS) {
        if (config[key] !== undefined && config[key] !== null && config[key] !== "") {
          credentials[key] = config[key];
          delete config[key];
          changed = true;
        }
      }

      if (!changed) continue;

      const encrypted = encryptJson(credentials);
      await pool.query(
        `UPDATE channels
            SET config = CAST(? AS JSON),
                credentials_encrypted = ?
          WHERE id = ?
            AND credentials_encrypted IS NULL`,
        [JSON.stringify(config), encrypted, row.id]
      );
      migrated += 1;
    }

    console.log(`Channel credential migration complete. Migrated ${migrated} channel(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`Channel credential migration failed: ${err.message}`);
  process.exitCode = 1;
});
