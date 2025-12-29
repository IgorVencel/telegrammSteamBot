import { User } from "../models/User.js";
import { SteamService } from "../services/SteamService.js";

export async function statusCommand(ctx) {
  const users = await User.getActive();
  
  if (users.length === 0) {
    return ctx.reply("📭 Никто не подключил отслеживание Steam.\n\nИспользуй /allow_steam <steam_id> чтобы начать.");
  }

  let message = "📊 <b>Статус отслеживаемых пользователей:</b>\n\n";

  for (const u of users) {
    try {
      const info = await SteamService.getInfo(u.steam_id);
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

  if (message.length > 4000) {
    message = message.substring(0, 4000) + "\n\n... (список усечён)";
  }

  ctx.reply(message, { parse_mode: "HTML" });
}
