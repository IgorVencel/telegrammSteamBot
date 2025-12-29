import { Telegraf } from "telegraf";
import { Client } from "pg";
import fetch from "node-fetch";
import "dotenv/config";
import levenshtein from "levenshtein-edit-distance";

// === Настройки ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const STEAM_KEY = process.env.STEAM_KEY;
const MESSAGE_THREAD_ID = process.env.MESSAGE_THREAD_ID
  ? parseInt(process.env.MESSAGE_THREAD_ID, 10)
  : null;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN || !GROUP_CHAT_ID || !STEAM_KEY || !DATABASE_URL) {
  console.error("❌ Отсутствуют обязательные переменные окружения");
  process.exit(1);
}

// === Инициализация Telegram и PostgreSQL ===
const bot = new Telegraf(BOT_TOKEN);
const db = new Client({ connectionString: DATABASE_URL });

// === Подключение к БД ===
await db.connect();
console.log("✅ Подключено к PostgreSQL");

// === Создание таблицы (если не существует) ===
await db.query(`
  CREATE TABLE IF NOT EXISTS users (
    tg_id BIGINT PRIMARY KEY,
    tg_username TEXT,
    steam_id TEXT NOT NULL,
    last_game TEXT,
    allowed BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
console.log("✅ Таблица 'users' готова");

// === Вспомогательные функции БД ===
async function saveUser(tgId, userData) {
  const { tgUsername, steamId, lastGame, allowed } = userData;
  await db.query(
    `
      INSERT INTO users (tg_id, tg_username, steam_id, last_game, allowed)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tg_id) DO UPDATE SET
        tg_username = EXCLUDED.tg_username,
        steam_id = EXCLUDED.steam_id,
        last_game = EXCLUDED.last_game,
        allowed = EXCLUDED.allowed;
    `,
    [BigInt(tgId), tgUsername, steamId, lastGame, allowed]
  );
}

async function getUser(tgId) {
  const res = await db.query("SELECT * FROM users WHERE tg_id = $1", [BigInt(tgId)]);
  return res.rows[0] || null;
}

async function setActive(tgId, allowed) {
  await db.query("UPDATE users SET allowed = $1 WHERE tg_id = $2", [allowed, BigInt(tgId)]);
}

async function setLastGame(tgId, game) {
  await db.query("UPDATE users SET last_game = $1 WHERE tg_id = $2", [game, BigInt(tgId)]);
}

async function getActiveUsers() {
  const res = await db.query("SELECT * FROM users WHERE allowed = true");
  return res.rows;
}

// === Steam API ===
async function getSteamInfo(steamId) {
  const url =
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?" +
    new URLSearchParams({ key: STEAM_KEY, steamids: steamId });

  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.response?.players?.[0];
  } catch (err) {
    console.error(`❌ Steam API error для ${steamId}:`, err.message);
    return null;
  }
}

// === Команды Telegram ===
bot.command("chatid", (ctx) => {
  ctx.reply(`Chat ID: ${ctx.chat.id}`);
});

bot.command("allow_steam", async (ctx) => {
  const steamId = ctx.message.text.split(" ")[1];
  if (!steamId || !/^\d{17,}$/.test(steamId)) {
    return ctx.reply(
      "Используй:\n/allow_steam <steam_id>\n\nSteamID — длинное число (SteamID64)."
    );
  }

  await saveUser(ctx.from.id, {
    tgUsername: ctx.from.username || ctx.from.first_name,
    steamId,
    lastGame: null,
    allowed: true,
  });

  ctx.reply("👍 Тебя добавил в список отслеживания Steam");
});

bot.command("stop_steam", async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply("Ты не был в списке отслеживания.");

  await setActive(ctx.from.id, false);
  ctx.reply("🛑 Отслеживание выключено");
});

// === Проверка активности ===
async function checkActivity() {
  console.log("🔍 Проверка активности игроков...");
  const users = await getActiveUsers();

  for (const u of users) {
    try {
      const info = await getSteamInfo(u.steam_id);
      if (!info) continue;

      const game = info.gameextrainfo || null;

      if (!game) {
        await setLastGame(u.tg_id, null);
        continue;
      }

      if (game === u.last_game) continue;

      await setLastGame(u.tg_id, game);

      const message = `🎮 ${info.personaname} запустил <b>${game}</b>`;
      const options = { parse_mode: "HTML" };
      if (MESSAGE_THREAD_ID) options.message_thread_id = MESSAGE_THREAD_ID;

      await bot.telegram.sendMessage(GROUP_CHAT_ID, message, options);
      console.log(`✅ Уведомление отправлено: ${info.personaname} → ${game}`);
    } catch (err) {
      console.error(`⚠️ Ошибка для пользователя ${u.tg_id}:`, err.message);
    }
  }
}

setInterval(checkActivity, 60 * 1000);

// Обработчик неизвестных команд с предложением исправления
bot.on("text", (ctx) => {
  const text = ctx.message.text?.trim();
  if (!text?.startsWith("/")) return;

  // Извлекаем чистую команду
  let command = text.split(" ")[0].toLowerCase();
  if (command.includes("@")) {
    const [cmd, botName] = command.split("@");
    if (botName?.toLowerCase() === ctx.me.toLowerCase()) {
      command = cmd;
    }
  }

  const knownCommands = ["/start", "/help", "/chatid", "/allow_steam", "/stop_steam"];

  // Если команда известна — не мешаем (на случай, если сработал другой обработчик)
  if (knownCommands.includes(command)) return;

  // Ищем наиболее похожую команду
  let bestMatch = null;
  let minDistance = Infinity;

  for (const known of knownCommands) {
    const dist = levenshtein(command, known);
    // Учитываем только разумные совпадения (макс. 3 ошибки)
    if (dist < minDistance && dist <= 3) {
      minDistance = dist;
      bestMatch = known;
    }
  }

  let replyText =
    "Извините, видимо вы запустили слишком много ракет 🚀 в последние дни, " +
    "потому что так опечататься мог только бывалый космонавт.\n"

  if (bestMatch) {
    replyText += `\n\nЕбло, попробуй еще раз: ${bestMatch}`;
  } else {
    replyText += 'Ебать ты на приколе, я вообще хз что ты имел ввиду';
  }

  replyText += "\n\nРазработано при пиздеже Alex.F";

  return ctx.reply(replyText);
});

// === Запуск ===
bot.catch((err, ctx) => {
  console.error(`🔥 Telegram ошибка:`, err);
});

bot.launch();
console.log("✅ Steam watcher bot запущен с PostgreSQL");
