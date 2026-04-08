import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  ComponentType,
  type Interaction,
} from "discord.js";
import type { ResoniteContact } from "./resonite.js";

export interface DiscordBotConfig {
  token: string;
  channelId: string;
}

/**
 * Callback invoked when a Discord user clicks Accept or Ignore.
 * Returns `true` if the action succeeded, `false` otherwise.
 */
export type FriendRequestAction = (
  contact: ResoniteContact,
  action: "accept" | "ignore",
) => Promise<boolean>;

export class DiscordBot {
  private client: Client;
  private config: DiscordBotConfig;
  private onAction: FriendRequestAction;
  private channel: TextChannel | null = null;

  constructor(config: DiscordBotConfig, onAction: FriendRequestAction) {
    this.config = config;
    this.onAction = onAction;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });
  }

  async start(): Promise<void> {
    // Set up button interaction handler
    this.client.on("interactionCreate", (interaction) => {
      void this.handleInteraction(interaction);
    });

    await this.client.login(this.config.token);

    // Resolve the target channel
    const ch = await this.client.channels.fetch(this.config.channelId);
    if (!ch || !(ch instanceof TextChannel)) {
      throw new Error(
        `Discord channel ${this.config.channelId} not found or is not a text channel`,
      );
    }
    this.channel = ch;

    console.log(
      `[Discord] Bot ready as ${this.client.user?.tag ?? "unknown"}`,
    );
  }

  async stop(): Promise<void> {
    await this.client.destroy();
    console.log("[Discord] Bot stopped");
  }

  isHealthy(): boolean {
    return this.client.isReady() && this.channel !== null;
  }

  /**
   * Send a friend request notification to the configured channel.
   * Includes Accept and Ignore buttons.
   */
  async notifyFriendRequest(contact: ResoniteContact): Promise<void> {
    if (!this.channel) {
      console.error("[Discord] Channel not ready, skipping notification");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Resonite フレンドリクエスト")
      .setDescription(
        `**${contact.contactUsername}** (${contact.id}) からフレンドリクエストが届きました。`,
      )
      .setColor(0x3498db)
      .setTimestamp();

    if (contact.profile?.iconUrl) {
      embed.setThumbnail(contact.profile.iconUrl);
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`accept:${contact.id}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅"),
      new ButtonBuilder()
        .setCustomId(`ignore:${contact.id}`)
        .setLabel("Ignore")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("❌"),
    );

    await this.channel.send({
      embeds: [embed],
      components: [row],
    });

    console.log(
      `[Discord] Sent friend request notification for ${contact.contactUsername}`,
    );
  }

  // ── Interaction handler ──────────────────────────────────────────

  /**
   * A map of contact ID -> contact data, so we can look up the full
   * contact when a button is clicked. Populated externally.
   */
  pendingRequests = new Map<string, ResoniteContact>();

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isButton()) return;

    const [action, contactId] = interaction.customId.split(":");
    if (!action || !contactId) return;
    if (action !== "accept" && action !== "ignore") return;

    const contact = this.pendingRequests.get(contactId);
    if (!contact) {
      await interaction.reply({
        content: "このリクエストの情報が見つかりませんでした。Bot再起動前のリクエストの可能性があります。",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const success = await this.onAction(contact, action);

      const embed = EmbedBuilder.from(interaction.message.embeds[0]!);

      if (success) {
        if (action === "accept") {
          embed
            .setColor(0x2ecc71)
            .setFooter({
              text: `✅ ${interaction.user.displayName} が承認しました`,
            });
        } else {
          embed
            .setColor(0xe74c3c)
            .setFooter({
              text: `❌ ${interaction.user.displayName} が拒否しました`,
            });
        }
      } else {
        embed.setColor(0x95a5a6).setFooter({ text: "⚠️ 処理に失敗しました" });
      }

      // Disable buttons after action
      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`accept:${contactId}`)
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`ignore:${contactId}`)
          .setLabel("Ignore")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true),
      );

      await interaction.editReply({
        embeds: [embed],
        components: [disabledRow],
      });

      // Clean up
      this.pendingRequests.delete(contactId);
    } catch (err) {
      console.error("[Discord] Error handling interaction:", err);
      try {
        await interaction.editReply({
          content: "エラーが発生しました。",
        });
      } catch {
        // ignore follow-up errors
      }
    }
  }
}
