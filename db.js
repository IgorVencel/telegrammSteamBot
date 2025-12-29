import { Client } from "pg";
import config from "./config.js";

const db = new Client({ connectionString: config.databaseUrl });

await db.connect();
console.log("✅ Подключено к PostgreSQL");

// Инициализация таблицы и ограничений
await db.query(`
  CREATE TABLE IF NOT EXISTS users (
    tg_id BIGINT PRIMARY KEY,
    tg_username TEXT,
    steam_id TEXT NOT NULL,
    last_game TEXT,
    allowed BOOLEAN DEFAULT true,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

try {
  await db.query(`
    ALTER TABLE users
    ADD CONSTRAINT unique_steam_id UNIQUE (steam_id);
  `);
  console.log("✅ Ограничение уникальности на steam_id добавлено");
} catch (err) {
  if (!err.message.includes("already exists")) {
    if (err.message.includes("duplicate key value violates unique constraint")) {
      console.error("❌ В таблице уже есть дубликаты steam_id!");
      process.exit(1);
    } else {
      console.error("⚠️ Ошибка при добавлении ограничения:", err.message);
    }
  }
}

export default db;
