import { User } from "../models/User.js";

export const awaitingComment = new Map();

export async function commentCommand(ctx) {
  const comment = ctx.message.text.split(" ").slice(1).join(" ").trim();

  if (comment) {
    const user = await User.get(ctx.from.id);
    if (!user) {
      return ctx.reply("Сначала добавь себя через /allow_steam <steam_id>");
    }
    await User.setComment(ctx.from.id, comment);
    return ctx.reply(`✅ Комментарий сохранён:\n\n«${comment}»`);
  }

  const user = await User.get(ctx.from.id);
  if (!user) {
    return ctx.reply("Сначала добавь себя через /allow_steam <steam_id>");
  }

  awaitingComment.set(ctx.from.id, true);
  ctx.reply("💬 Отправь свой комментарий (можно с эмодзи и форматированием):");
}
