import { describe, it, expect } from "vitest";
import { DiscordBot } from "../discord.js";

describe("DiscordBot", () => {
  it("should be instantiable with valid config", () => {
    const bot = new DiscordBot(
      { token: "fake-token", channelId: "123456789" },
      async () => true,
    );
    expect(bot).toBeDefined();
    expect(bot.pendingRequests).toBeInstanceOf(Map);
  });

  it("should manage pendingRequests map", () => {
    const bot = new DiscordBot(
      { token: "fake-token", channelId: "123456789" },
      async () => true,
    );

    const contact = {
      id: "U-test",
      contactUsername: "TestUser",
      ownerId: "U-owner",
      contactStatus: "Requested",
      friendStatus: "Requested",
      isAccepted: false,
    };

    bot.pendingRequests.set(contact.id, contact);
    expect(bot.pendingRequests.has("U-test")).toBe(true);
    expect(bot.pendingRequests.get("U-test")?.contactUsername).toBe("TestUser");

    bot.pendingRequests.delete("U-test");
    expect(bot.pendingRequests.has("U-test")).toBe(false);
  });
});
