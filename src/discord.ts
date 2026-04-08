import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  ComponentType,
  SlashCommandBuilder,
  REST,
  Routes,
  MessageFlags,
  type Interaction,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { ResoniteContact } from "./resonite.js";

/**
 * Convert a Resonite asset URL (resdb:///hash.ext) to an HTTPS URL
 * that Discord can display. Returns `null` for unsupported schemes.
 */
function resolveResoniteAssetUrl(url: string): string | null {
  if (url.startsWith("https://") || url.startsWith("http://")) {
    return url;
  }
  // resdb:///18583a84ec40029513636535cf1f4b6b603094e81db7c3f677518b34674c34e7.webp
  //   → https://assets.resonite.com/18583a84ec40029513636535cf1f4b6b603094e81db7c3f677518b34674c34e7
  const match = url.match(/^resdb:\/\/\/([a-f0-9]+)\.\w+$/i);
  if (match) {
    return `https://assets.resonite.com/${match[1]}`;
  }
  return null;
}

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

/**
 * Callback to fetch contact data from the Resonite API.
 */
export type SlashCommandHandler = {
  getContacts: () => Promise<ResoniteContact[] | null>;
  acceptContact: (contact: ResoniteContact) => Promise<boolean>;
};

export class DiscordBot {
  private client: Client;
  private config: DiscordBotConfig;
  private onAction: FriendRequestAction;
  private channel: TextChannel | null = null;
  private slashHandler: SlashCommandHandler | null = null;

  constructor(config: DiscordBotConfig, onAction: FriendRequestAction) {
    this.config = config;
    this.onAction = onAction;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });
  }

  /**
   * Register the slash command handler providing access to Resonite data.
   * Must be called before `start()`.
   */
  setSlashCommandHandler(handler: SlashCommandHandler): void {
    this.slashHandler = handler;
  }

  async start(): Promise<void> {
    // Set up interaction handler (buttons + slash commands)
    this.client.on("interactionCreate", (interaction) => {
      void this.handleInteraction(interaction);
    });

    await this.client.login(this.config.token);

    // Register slash commands
    await this.registerSlashCommands();

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
      const thumbnailUrl = resolveResoniteAssetUrl(contact.profile.iconUrl);
      if (thumbnailUrl) {
        embed.setThumbnail(thumbnailUrl);
      }
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

  // ── Slash commands ────────────────────────────────────────────────

  private async registerSlashCommands(): Promise<void> {
    if (!this.client.user) return;

    const commands = [
      new SlashCommandBuilder()
        .setName("friends")
        .setDescription("Resoniteのフレンド一覧を表示します"),
      new SlashCommandBuilder()
        .setName("requests")
        .setDescription("保留中・無視済みのフレンドリクエストを表示します"),
      new SlashCommandBuilder()
        .setName("accept")
        .setDescription("無視したフレンドリクエストを承認します")
        .addStringOption((option) =>
          option
            .setName("user_id")
            .setDescription("承認するユーザーID (例: U-someone)")
            .setRequired(true),
        ),
    ];

    const rest = new REST({ version: "10" }).setToken(this.config.token);
    await rest.put(Routes.applicationCommands(this.client.user.id), {
      body: commands.map((c) => c.toJSON()),
    });

    console.log("[Discord] Slash commands registered");
  }

  private async handleSlashCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!this.slashHandler) {
      await interaction.reply({
        content: "スラッシュコマンドは現在利用できません。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { commandName } = interaction;

    try {
      if (commandName === "friends") {
        await this.handleFriendsCommand(interaction);
      } else if (commandName === "requests") {
        await this.handleRequestsCommand(interaction);
      } else if (commandName === "accept") {
        await this.handleAcceptCommand(interaction);
      }
    } catch (err) {
      console.error(`[Discord] Slash command /${commandName} failed:`, err);
      const content = "コマンドの実行中にエラーが発生しました。";
      if (interaction.deferred) {
        await interaction.editReply({ content }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  }

  private async handleFriendsCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const contacts = await this.slashHandler!.getContacts();
    if (contacts === null) {
      await interaction.editReply({
        content: "コンタクトリストの取得に失敗しました。しばらくしてから再試行してください。",
      });
      return;
    }
    const friends = contacts.filter(
      (c) => c.contactStatus === "Accepted" && c.isAccepted,
    );

    if (friends.length === 0) {
      await interaction.editReply({ content: "フレンドはいません。" });
      return;
    }

    // Paginate into chunks to fit Discord embed limits
    const PAGE_SIZE = 20;
    const pages: string[] = [];
    for (let i = 0; i < friends.length; i += PAGE_SIZE) {
      const chunk = friends.slice(i, i + PAGE_SIZE);
      pages.push(
        chunk
          .map(
            (f, idx) => `**${i + idx + 1}.** ${f.contactUsername} (\`${f.id}\`)`,
          )
          .join("\n"),
      );
    }

    const embeds = pages.map((page, idx) =>
      new EmbedBuilder()
        .setTitle(
          pages.length > 1
            ? `Resonite フレンド一覧 (${idx + 1}/${pages.length})`
            : "Resonite フレンド一覧",
        )
        .setDescription(page)
        .setColor(0x2ecc71)
        .setFooter({ text: `合計: ${friends.length}人` }),
    );

    // Discord allows up to 10 embeds per message
    await interaction.editReply({ embeds: embeds.slice(0, 10) });
  }

  private async handleRequestsCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const contacts = await this.slashHandler!.getContacts();
    if (contacts === null) {
      await interaction.editReply({
        content: "コンタクトリストの取得に失敗しました。しばらくしてから再試行してください。",
      });
      return;
    }

    const pending = contacts.filter(
      (c) => c.contactStatus === "Accepted" && !c.isAccepted,
    );
    const ignored = contacts.filter(
      (c) => c.contactStatus === "Ignored",
    );

    const embeds: EmbedBuilder[] = [];

    if (pending.length > 0) {
      const desc = pending
        .map(
          (c, i) => `**${i + 1}.** ${c.contactUsername} (\`${c.id}\`)`,
        )
        .join("\n");
      embeds.push(
        new EmbedBuilder()
          .setTitle("保留中のフレンドリクエスト")
          .setDescription(desc)
          .setColor(0x3498db)
          .setFooter({ text: `${pending.length}件` }),
      );
    }

    if (ignored.length > 0) {
      const desc = ignored
        .map(
          (c, i) => `**${i + 1}.** ${c.contactUsername} (\`${c.id}\`)`,
        )
        .join("\n");
      embeds.push(
        new EmbedBuilder()
          .setTitle("無視済みのフレンドリクエスト")
          .setDescription(
            desc + "\n\n`/accept user_id:<ID>` で承認できます。",
          )
          .setColor(0xe74c3c)
          .setFooter({ text: `${ignored.length}件` }),
      );
    }

    if (embeds.length === 0) {
      await interaction.editReply({
        content: "保留中・無視済みのフレンドリクエストはありません。",
      });
      return;
    }

    await interaction.editReply({ embeds });
  }

  private async handleAcceptCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const userId = interaction.options.getString("user_id", true).trim();
    const contacts = await this.slashHandler!.getContacts();
    if (contacts === null) {
      await interaction.editReply({
        content: "コンタクトリストの取得に失敗しました。しばらくしてから再試行してください。",
      });
      return;
    }

    const contact = contacts.find((c) => c.id === userId);
    if (!contact) {
      await interaction.editReply({
        content: `ユーザー \`${userId}\` はコンタクトリストに見つかりませんでした。`,
      });
      return;
    }

    if (contact.contactStatus === "Accepted" && contact.isAccepted) {
      await interaction.editReply({
        content: `**${contact.contactUsername}** は既にフレンドです。`,
      });
      return;
    }

    const success = await this.slashHandler!.acceptContact(contact);

    if (success) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("フレンドリクエスト承認")
            .setDescription(
              `**${contact.contactUsername}** (\`${contact.id}\`) のフレンドリクエストを承認しました。`,
            )
            .setColor(0x2ecc71),
        ],
      });
    } else {
      await interaction.editReply({
        content: `**${contact.contactUsername}** の承認に失敗しました。`,
      });
    }
  }

  // ── Interaction handler ──────────────────────────────────────────

  /**
   * A map of contact ID -> contact data, so we can look up the full
   * contact when a button is clicked. Populated externally.
   */
  pendingRequests = new Map<string, ResoniteContact>();

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      await this.handleSlashCommand(interaction);
      return;
    }

    if (!interaction.isButton()) return;

    const [action, contactId] = interaction.customId.split(":");
    if (!action || !contactId) return;
    if (action !== "accept" && action !== "ignore") return;

    const contact = this.pendingRequests.get(contactId);
    if (!contact) {
      await interaction.reply({
        content: "このリクエストの情報が見つかりませんでした。Bot再起動前のリクエストの可能性があります。",
        flags: MessageFlags.Ephemeral,
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
