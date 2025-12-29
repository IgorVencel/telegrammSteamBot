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

const awaitingSteamId = new Map();

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
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
console.log("✅ Таблица 'users' готова");

// Добавляем ограничение уникальности на steam_id
try {
  await db.query(`
    ALTER TABLE users
    ADD CONSTRAINT unique_steam_id UNIQUE (steam_id);
  `);
  console.log("✅ Ограничение уникальности на steam_id добавлено");
} catch (err) {
  if (err.message.includes('already exists')) {
    console.log("ℹ️ Ограничение уникальности на steam_id уже существует");
  } else if (err.message.includes('duplicate key value violates unique constraint')) {
    console.error("❌ В таблице уже есть дубликаты steam_id! Уберите их вручную.");
    process.exit(1);
  } else {
    console.error("⚠️ Неизвестная ошибка при добавлении ограничения:", err.message);
  }
}

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

async function setComment(tgId, comment) {
  await db.query("UPDATE users SET comment = $1 WHERE tg_id = $2", [comment, BigInt(tgId)]);
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

  // Если SteamID передан сразу — обрабатываем как раньше
  if (steamId && /^\d{17,}$/.test(steamId)) {
    try {
      await saveUser(ctx.from.id, {
        tgUsername: ctx.from.username || ctx.from.first_name,
        steamId,
        lastGame: null,
        allowed: true,
      });
      ctx.reply("👍 Тебя добавил в список отслеживания Steam");
    } catch (err) {
      if (err.message.includes("unique constraint") || err.message.includes("unique_steam_id")) {
        ctx.reply(
          "❌ Этот SteamID уже привязан к другому Telegram-аккаунту.\n\n" +
          "Каждый SteamID можно использовать только один раз."
        );
      } else {
        console.error("Ошибка при добавлении пользователя:", err);
        ctx.reply("⚠️ Произошла ошибка. Попробуйте позже.");
      }
    }
    return;
  }

  // Иначе — запрашиваем SteamID отдельно
  awaitingSteamId.set(ctx.from.id, true);
  ctx.reply(
    "🆔 Пожалуйста, отправь свой SteamID64.\n\n" +
    "Это длинное число, начинающееся с 7656119...\n" +
    "Узнать его можно на сайте: https://steamid.io"
  );
});

bot.command("stop_steam", async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply("Ты не был в списке отслеживания.");

  await setActive(ctx.from.id, false);
  ctx.reply("🛑 Отслеживание выключено");
});

bot.command("comment", async (ctx) => {
  // Получаем текст после команды: "/comment привет" → "привет"
  const comment = ctx.message.text.split(" ").slice(1).join(" ").trim();

  if (!comment) {
    return ctx.reply(
      "Используй:\n/comment <текст>\n\nПример: /comment Жду 5 минут, потом стартую!"
    );
  }

  // Проверяем, есть ли пользователь в БД
  const user = await getUser(ctx.from.id);
  if (!user) {
    return ctx.reply("Сначала добавь себя через /allow_steam <steam_id>");
  }

  // Сохраняем комментарий
  await setComment(ctx.from.id, comment);
  ctx.reply(`✅ Комментарий сохранён:\n\n«${comment}»`);
});

bot.command("status", async (ctx) => {
  const users = await getActiveUsers();
  
  if (users.length === 0) {
    return ctx.reply("📭 Никто не подключил отслеживание Steam.\n\nИспользуй /allow_steam <steam_id> чтобы начать.");
  }

  let message = "📊 <b>Статус отслеживаемых пользователей:</b>\n\n";

  for (const u of users) {
    try {
      const info = await getSteamInfo(u.steam_id);
      if (!info) {
        message += `⚠️ <b>${u.tg_username || 'Неизвестно'}</b>: не удалось получить данные\n`;
        continue;
      }

      if (info.gameextrainfo) {
        message += `🎮 <b>${info.personaname}</b> играет в <i>${info.gameextrainfo}</i>\n`;
      } else {
        message += `✅ <b>${info.personaname}</b>: в сети, но не в игре\n`;
      }
    } catch (err) {
      message += `⚠️ <b>${u.tg_username || 'Неизвестно'}</b>: ошибка при запросе\n`;
    }
  }

  // Ограничиваем длину сообщения (Telegram имеет лимит ~4096 символов)
  if (message.length > 4000) {
    message = message.substring(0, 4000) + "\n\n... (список усечён)";
  }

  ctx.reply(message, { parse_mode: "HTML" });
});

// === Проверка активности ===
async function checkActivity() {
  console.log("🔍 Проверка активности игроков...");
  const users = await getActiveUsers();

  for (const u of users) {
    try {
      const info = await getSteamInfo(u.steam_id);
      if (!info) continue;

      const currentGame = info.gameextrainfo || null;
      const lastGame = u.last_game;

      // Случай 1: пользователь вышел из игры
      if (lastGame && !currentGame) {
        // Отправляем уведомление об окончании
        const message = `⏹️ ${info.personaname} закончил играть в <b>${lastGame}</b>`;
        const options = { parse_mode: "HTML" };
        if (MESSAGE_THREAD_ID) options.message_thread_id = MESSAGE_THREAD_ID;

        await bot.telegram.sendMessage(GROUP_CHAT_ID, message, options);
        console.log(`✅ Уведомление о выходе: ${info.personaname} → ${lastGame}`);

        // Обновляем last_game на null
        await setLastGame(u.tg_id, null);
      }

      // Случай 2: пользователь запустил новую игру
      else if (currentGame && currentGame !== lastGame) {
        let message = `🎮 ${info.personaname} запустил <b>${currentGame}</b>`;
      
        // Добавляем комментарий, если он есть
        if (u.comment) {
          message += `\n\n💬 <i>${u.comment}</i>`;
        }
      
        const options = { parse_mode: "HTML" };
        if (MESSAGE_THREAD_ID) options.message_thread_id = MESSAGE_THREAD_ID;
      
        await bot.telegram.sendMessage(GROUP_CHAT_ID, message, options);
        console.log(`✅ Уведомление о запуске: ${info.personaname} → ${currentGame}`);
      
        await setLastGame(u.tg_id, currentGame);
      }

      // Случай 3: игра не изменилась — ничего не делаем
    } catch (err) {
      console.error(`⚠️ Ошибка для пользователя ${u.tg_id}:`, err.message);
    }
  }
}

setInterval(checkActivity, 60 * 1000);

// Обработка текста: ожидание SteamID + неизвестные команды
bot.on("text", async (ctx) => {
  const tgId = ctx.from.id;

  // 1. Проверяем, ожидает ли пользователь ввода SteamID
  if (awaitingSteamId.has(tgId)) {
    const input = ctx.message.text.trim();

    // Проверяем, что это валидный SteamID64
    if (/^\d{17,}$/.test(input)) {
      try {
        await saveUser(tgId, {
          tgUsername: ctx.from.username || ctx.from.first_name,
          steamId: input,
          lastGame: null,
          allowed: true,
        });
        ctx.reply("👍 Отлично! Тебя добавил в список отслеживания Steam.");
      } catch (err) {
        if (err.message.includes("unique constraint") || err.message.includes("unique_steam_id")) {
          ctx.reply(
            "❌ Этот SteamID уже привязан к другому аккаунту."
          );
        } else {
          console.error("Ошибка при добавлении:", err);
          ctx.reply("⚠️ Не удалось сохранить. Попробуй ещё раз.");
        }
      }
    } else {
      // Неверный формат — просим снова
      ctx.reply(
        "❌ Это не похоже на SteamID64.\n\n" +
        "Пришлите длинное число (например: 76561198012345678)"
      );
      return; // остаёмся в ожидании
    }

    // Удаляем из ожидания в любом случае
    awaitingSteamId.delete(tgId);
    return;
  }

  // 2. Если не ожидаем SteamID — обрабатываем как неизвестную команду
  const text = ctx.message.text?.trim();
  if (!text?.startsWith("/")) return;

  let command = text.split(" ")[0].toLowerCase();
  if (command.includes("@")) {
    const [cmd, botName] = command.split("@");
    if (botName?.toLowerCase() === ctx.me.toLowerCase()) {
      command = cmd;
    }
  }

  const knownCommands = [
    "/start",
    "/help",
    "/chatid",
    "/allow_steam",
    "/stop_steam",
    "/comment",
    "/status"
  ];

  if (knownCommands.includes(command)) return;

  // Ищем наиболее похожую команду
  let bestMatch = null;
  let minDistance = Infinity;

  for (const known of knownCommands) {
    const dist = levenshtein(command, known);
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
    replyText += '\n\nЕбать ты на приколе, я вообще хз что ты имел ввиду';
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
