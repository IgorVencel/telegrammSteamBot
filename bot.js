import { Telegraf } from "telegraf";
import fs from "fs";
import fetch from "node-fetch";
import "dotenv/config";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const STEAM_KEY = process.env.STEAM_KEY;

let users = JSON.parse(fs.readFileSync("users.json", "utf8"));

function saveUsers() {
  fs.writeFileSync("users.json", JSON.stringify(users, null, 2));
}

async function getSteamInfo(steamId) {
  const url =
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?" +
    new URLSearchParams({
      key: STEAM_KEY,
      steamids: steamId
    });

  const res = await fetch(url);
  const data = await res.json();
  return data.response.players?.[0];
}

// команда для проверки group id
bot.command("chatid", ctx => {
  ctx.reply(`Chat ID: ${ctx.chat.id}`);
});

// добавить себя в отслеживание
bot.command("allow_steam", async ctx => {
  const steamId = ctx.message.text.split(" ")[1];

  if (!steamId) {
    return ctx.reply(
      "Используй:\n/allow_steam <steam_id>\n\nSteamID можно взять в настройках профиля."
    );
  }

  users[ctx.from.id] = {
    tg: ctx.from.username || ctx.from.first_name,
    steamId,
    lastGame: null,
    allowed: true
  };

  saveUsers();

  ctx.reply("👍 Тебя добавил в список отслеживания Steam");
});

// отключить отслеживание
bot.command("stop_steam", ctx => {
  if (!users[ctx.from.id]) return ctx.reply("Ты не был в списке отслеживания.");

  users[ctx.from.id].allowed = false;
  saveUsers();

  ctx.reply("🛑 Отслеживание выключено");
});

// проверка активности игроков
async function checkActivity() {
  for (const [tgId, u] of Object.entries(users)) {
    if (!u.allowed) continue;

    try {
      const info = await getSteamInfo(u.steamId);
      if (!info) continue;

      const game = info.gameextrainfo || null;

      // не в игре → сбрасываем статус
      if (!game) {
        users[tgId].lastGame = null;
        continue;
      }

      // если игра не изменилась — пропускаем
      if (game === users[tgId].lastGame) continue;

      users[tgId].lastGame = game;
      saveUsers();

      await bot.telegram.sendMessage(
        GROUP_CHAT_ID,
        `🎮 ${info.personaname} запустил <b>${game}</b>`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.log("Steam API error:", err);
    }
  }
}

setInterval(checkActivity, 60 * 1000);

bot.launch();
console.log("Steam watcher bot запущен");
