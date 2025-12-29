import { Telegraf } from "telegraf";
import config from "./config.js";
import db from "./db.js";
import { allowSteamCommand } from "./commands/allowSteam.js";
import { stopSteamCommand } from "./commands/stopSteam.js";
import { commentCommand } from "./commands/comment.js";
import { statusCommand } from "./commands/status.js";
import { chatIdCommand } from "./commands/chatid.js";
import { textHandler } from "./handlers/textHandler.js";
import { checkActivity } from "./jobs/checkActivity.js";

const bot = new Telegraf(config.botToken);

// Регистрация команд
bot.command("allow_steam", allowSteamCommand);
bot.command("stop_steam", stopSteamCommand);
bot.command("comment", commentCommand);
bot.command("status", statusCommand);
bot.command("chatid", chatIdCommand);

// Обработчик текста
bot.on("text", textHandler);

// Фоновая задача
setInterval(() => checkActivity(bot), 60 * 1000);

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`🔥 Telegram ошибка:`, err);
});

bot.launch();
console.log("✅ Steam watcher bot запущен с PostgreSQL");
