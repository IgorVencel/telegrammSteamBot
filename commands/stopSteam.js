import { User } from "../models/User.js";

export async function stopSteamCommand(ctx) {
  const user = await User.get(ctx.from.id);
  if (!user) {
    return ctx.reply("Ты не был в списке отслеживания.");
  }

  await User.setActive(ctx.from.id, false);
  ctx.reply("🛑 Отслеживание выключено");
}
