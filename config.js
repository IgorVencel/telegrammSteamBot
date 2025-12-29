import "dotenv/config";

const config = {
  botToken: process.env.BOT_TOKEN,
  groupChatId: process.env.GROUP_CHAT_ID,
  steamKey: process.env.STEAM_KEY,
  messageThreadId: process.env.MESSAGE_THREAD_ID
    ? parseInt(process.env.MESSAGE_THREAD_ID, 10)
    : null,
  databaseUrl: process.env.DATABASE_URL,
};

if (!config.botToken || !config.groupChatId || !config.steamKey || !config.databaseUrl) {
  throw new Error("❌ Отсутствуют обязательные переменные окружения");
}

export default config;
