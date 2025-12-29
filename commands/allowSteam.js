import { User } from "../models/User.js";

const awaitingSteamId = new Map();

export { awaitingSteamId };

export async function allowSteamCommand(ctx) {
  const steamId = ctx.message.text.split(" ")[1];

  if (steamId && /^\d{17,}$/.test(steamId)) {
    try {
      await User.save(ctx.from.id, {
        tgUsername: ctx.from.username || ctx.from.first_name,
        steamId,
        lastGame: null,
        allowed: true,
      });
      ctx.reply("👍 Тебя добавил в список отслеживания Steam");
    } catch (err) {
      if (err.message.includes("unique constraint") || err.message.includes("unique_steam_id")) {
        ctx.reply("❌ Этот SteamID уже привязан к другому аккаунту.");
      } else {
        console.error("Ошибка при добавлении:", err);
        ctx.reply("⚠️ Не удалось сохранить. Попробуй ещё раз.");
      }
    }
    return;
  }

  awaitingSteamId.set(ctx.from.id, true);
  ctx.reply(
    "🆔 Пожалуйста, отправь свой SteamID64.\n\n" +
    "Это длинное число, начинающееся с 7656119...\n" +
    "Узнать его можно на сайте: https://steamid.io"
  );
}
