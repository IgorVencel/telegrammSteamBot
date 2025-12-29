import { User } from "../models/User.js";
import { SteamService } from "../services/SteamService.js";
import config from "../config.js";

export async function checkActivity(bot) {
  console.log("🔍 Проверка активности игроков...");
  const users = await User.getActive();

  for (const u of users) {
    try {
      const info = await SteamService.getInfo(u.steam_id);
      if (!info) continue;

      const currentGame = info.gameextrainfo || null;
      const lastGame = u.last_game;

      if (lastGame && !currentGame) {
        const message = `⏹️ ${info.personaname} закончил играть в <b>${lastGame}</b>`;
        const options = { parse_mode: "HTML" };
        if (config.messageThreadId) options.message_thread_id = config.messageThreadId;
        await bot.telegram.sendMessage(config.groupChatId, message, options);
        await User.setLastGame(u.tg_id, null);
      } else if (currentGame && currentGame !== lastGame) {
        let msg = `🎮 ${info.personaname} запустил <b>${currentGame}</b>`;
        if (u.comment) msg += `\n\n💬 <i>${u.comment}</i>`;
        const opts = { parse_mode: "HTML" };
        if (config.messageThreadId) opts.message_thread_id = config.messageThreadId;
        await bot.telegram.sendMessage(config.groupChatId, msg, opts);
        await User.setLastGame(u.tg_id, currentGame);
      }
    } catch (err) {
      console.error(`⚠️ Ошибка для пользователя ${u.tg_id}:`, err.message);
    }
  }
}
