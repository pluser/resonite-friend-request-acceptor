import "dotenv/config";
import { ResoniteClient, type ResoniteContact } from "./resonite.js";
import { DiscordBot } from "./discord.js";

// ── Config validation ───────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const RESONITE_USERNAME = requireEnv("RESONITE_USERNAME");
const RESONITE_PASSWORD = requireEnv("RESONITE_PASSWORD");
const RESONITE_TOTP = process.env["RESONITE_TOTP"] || undefined;

const DISCORD_TOKEN = requireEnv("DISCORD_TOKEN");
const DISCORD_CHANNEL_ID = requireEnv("DISCORD_CHANNEL_ID");

const POLL_INTERVAL_SECONDS = parseInt(
  process.env["POLL_INTERVAL_SECONDS"] || "60",
  10,
);

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Resonite Friend Request Acceptor ===");

  // 1. Create Resonite client
  const resonite = new ResoniteClient({
    username: RESONITE_USERNAME,
    password: RESONITE_PASSWORD,
    totp: RESONITE_TOTP,
  });

  // 2. Create Discord bot with action handler
  const discord = new DiscordBot(
    {
      token: DISCORD_TOKEN,
      channelId: DISCORD_CHANNEL_ID,
    },
    async (contact: ResoniteContact, action: "accept" | "ignore") => {
      try {
        if (action === "accept") {
          await resonite.acceptFriendRequest(contact);
        } else {
          await resonite.ignoreFriendRequest(contact);
        }
        return true;
      } catch (err) {
        console.error(`[Main] Failed to ${action} friend request:`, err);
        return false;
      }
    },
  );

  // 3. Login to Resonite
  await resonite.login();
  await resonite.start();

  // 4. Start Discord bot
  await discord.start();

  // 5. Listen for new friend requests from Resonite
  resonite.on("friendRequest", (contact: ResoniteContact) => {
    console.log(
      `[Main] New friend request from ${contact.contactUsername} (${contact.id})`,
    );
    // Store for button interaction lookup
    discord.pendingRequests.set(contact.id, contact);
    // Send notification
    void discord.notifyFriendRequest(contact);
  });

  // 6. Start polling
  console.log(
    `[Main] Polling for friend requests every ${POLL_INTERVAL_SECONDS}s...`,
  );

  // Initial poll
  await resonite.pollFriendRequests();

  const pollTimer = setInterval(() => {
    void resonite.pollFriendRequests();
  }, POLL_INTERVAL_SECONDS * 1000);

  // 7. Graceful shutdown
  const shutdown = async () => {
    console.log("\n[Main] Shutting down...");
    clearInterval(pollTimer);
    await discord.stop();
    await resonite.logout();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("[Main] Fatal error:", err);
  process.exit(1);
});
