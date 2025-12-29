import fetch from "node-fetch";
import config from "../config.js";

export class SteamService {
  static async getInfo(steamId) {
    const url =
      "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?" +
      new URLSearchParams({ key: config.steamKey, steamids: steamId });

    try {
      const res = await fetch(url);
      const data = await res.json();
      return data.response?.players?.[0];
    } catch (err) {
      console.error(`❌ Steam API error для ${steamId}:`, err.message);
      return null;
    }
  }
}
