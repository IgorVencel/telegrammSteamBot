import db from "../db.js";

export class User {
  static async save(tgId, userData) {
    const { tgUsername, steamId, lastGame, allowed } = userData;
    await db.query(
      `
        INSERT INTO users (tg_id, tg_username, steam_id, last_game, allowed)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tg_id) DO UPDATE SET
          tg_username = EXCLUDED.tg_username,
          steam_id = EXCLUDED.steam_id,
          last_game = EXCLUDED.last_game,
          allowed = EXCLUDED.allowed;
      `,
      [BigInt(tgId), tgUsername, steamId, lastGame, allowed]
    );
  }

  static async get(tgId) {
    const res = await db.query("SELECT * FROM users WHERE tg_id = $1", [BigInt(tgId)]);
    return res.rows[0] || null;
  }

  static async setActive(tgId, allowed) {
    await db.query("UPDATE users SET allowed = $1 WHERE tg_id = $2", [allowed, BigInt(tgId)]);
  }

  static async setLastGame(tgId, game) {
    await db.query("UPDATE users SET last_game = $1 WHERE tg_id = $2", [game, BigInt(tgId)]);
  }

  static async getActive() {
    const res = await db.query("SELECT * FROM users WHERE allowed = true");
    return res.rows;
  }

  static async setComment(tgId, comment) {
    await db.query("UPDATE users SET comment = $1 WHERE tg_id = $2", [comment, BigInt(tgId)]);
  }
}
