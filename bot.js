import { Telegraf } from "telegraf";
import fs from "fs";
import fetch from "node-fetch";
import "dotenv/config";

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const STEAM_KEY = process.env.STEAM_KEY;
const MESSAGE_THREAD_ID = process.env.MESSAGE_THREAD_ID
  ? parseInt(process.env.MESSAGE_THREAD_ID, 10)
  : null;

if (!BOT_TOKEN || !GROUP_CHAT_ID || !STEAM_KEY) {
  console.error("❌ Отсутствуют обязательные переменные окружения: BOT_TOKEN, GROUP_CHAT_ID или STEAM_KEY");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Убедимся, что users.json существует
if (!fs.existsSync("users.json")) {
  fs.writeFileSync("users.json", "{}");
  console.log("ℹ️ Создан пустой файл users.json");
}
let users = JSON.parse(fs.readFileSync("users.json", "utf8"));

function saveUsers() {
  try {
    fs.writeFileSync("users.json", JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("❌ Ошибка при сохранении users.json:", err);
  }
}

async function getSteamInfo(steamId) {
  const url =
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?" +
    new URLSearchParams({
      key: STEAM_KEY,
      steamids: steamId,
    });

  try {
    const res = await fetch(url);
    const data = await res.json();

    // Логируем для отладки (можно закомментировать в продакшене)
    // console.log("Steam API response:", JSON.stringify(data));

    return data.response?.players?.[0];
  } catch (err) {
    console.error(`❌ Ошибка при запросе Steam API для ${steamId}:`, err.message);
    return null;
  }
}

// Команда для проверки chat ID
bot.command("chatid", (ctx) => {
  ctx.reply(`Chat ID: ${ctx.chat.id}`);
});

// Добавить себя в отслеживание
bot.command("allow_steam", async (ctx) => {
  const steamId = ctx.message.text.split(" ")[1];

  if (!steamId) {
    return ctx.reply(
      "Используй:\n/allow_steam <steam_id>\n\nSteamID можно взять в настройках профиля."
    );
  }

  // Валидация: SteamID64 — это число от 76561197960265728 и выше
  if (!/^\d{17,}$/.test(steamId)) {
    return ctx.reply("❌ Некорректный SteamID. Убедитесь, что это SteamID64 (длинное число).");
  }

  users[ctx.from.id] = {
    tg: ctx.from.username || ctx.from.first_name,
    steamId,
    lastGame: null,
    allowed: true,
  };

  saveUsers();
  ctx.reply("👍 Тебя добавил в список отслеживания Steam");
});

// Отключить отслеживание
bot.command("stop_steam", (ctx) => {
  if (!users[ctx.from.id]) {
    return ctx.reply("Ты не был в списке отслеживания.");
  }

  users[ctx.from.id].allowed = false;
  saveUsers();
  ctx.reply("🛑 Отслеживание выключено");
});

// Проверка активности игроков
async function checkActivity() {
  console.log("🔍 Запуск проверки активности...");
  for (const [tgId, u] of Object.entries(users)) {
    if (!u.allowed) continue;

    try {
      const info = await getSteamInfo(u.steamId);
      if (!info) {
        console.log(`ℹ️ Нет данных от Steam для пользователя ${tgId}`);
        continue;
      }

      const game = info.gameextrainfo || null;

      // Не в игре → сбрасываем статус
      if (!game) {
        users[tgId].lastGame = null;
        continue;
      }

      // Если игра не изменилась — пропускаем
      if (game === users[tgId].lastGame) {
        continue;
      }

      users[tgId].lastGame = game;
      saveUsers();

      const message = `🎮 ${info.personaname} запустил <b>${game}</b>`;

      const options = {
        parse_mode: "HTML",
      };

      if (MESSAGE_THREAD_ID) {
        options.message_thread_id = MESSAGE_THREAD_ID;
      }

      await bot.telegram.sendMessage(GROUP_CHAT_ID, message, options);
      console.log(`✅ Отправлено уведомление: ${message}`);
    } catch (err) {
      console.error(`⚠️ Ошибка при обработке пользователя ${tgId}:`, err.message);
    }
  }
}

// Запускаем проверку каждую минуту
setInterval(checkActivity, 60 * 1000);

// Обработка ошибок Telegram
bot.catch((err, ctx) => {
  console.error(`🔥 Telegram ошибка для ${ctx.updateType}:`, err);
});

bot.launch();
console.log("✅ Steam watcher bot запущен");
console.log("ℹ️ GROUP_CHAT_ID:", GROUP_CHAT_ID);
if (MESSAGE_THREAD_ID) {
  console.log("ℹ️ MESSAGE_THREAD_ID:", MESSAGE_THREAD_ID);
}
