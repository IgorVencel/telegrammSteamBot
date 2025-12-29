import { User } from "../models/User.js";
import { awaitingSteamId } from "../commands/allowSteam.js";
import { awaitingComment } from "../commands/comment.js";
import { fuzzyMatch } from "../utils/fuzzyMatch.js";

export async function textHandler(ctx) {
  const tgId = ctx.from.id;

  // Ожидание SteamID
  if (awaitingSteamId.has(tgId)) {
    // ... логика обработки (аналогично предыдущему коду)
    return;
  }

  // Ожидание комментария
  if (awaitingComment.has(tgId)) {
    // ... логика обработки
    return;
  }

  // Неизвестные команды
  const text = ctx.message.text?.trim();
  if (!text?.startsWith("/")) return;

  const command = text.split(" ")[0].toLowerCase().split("@")[0];
  const knownCommands = ["/start", "/help", "/chatid", "/allow_steam", "/stop_steam", "/comment", "/status"];

  if (knownCommands.includes(command)) return;

  const bestMatch = fuzzyMatch(command, knownCommands);
  let replyText = "Извините, видимо вы запустили слишком много ракет 🚀...";

  if (bestMatch) {
    replyText += `\n\nЕбло, попробуй еще раз: ${bestMatch}`;
  } else {
    replyText += '\n\nЕбать ты на приколе, я вообще хз что ты имел ввиду';
  }

  replyText += "\n\nРазработано при пиздеже Alex.F";
  ctx.reply(replyText);
}
