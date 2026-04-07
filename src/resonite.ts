import * as signalR from "@microsoft/signalr";
import { randomUUID, createHash, randomBytes } from "crypto";
import { EventEmitter } from "events";

const BASE_API_URL = "https://api.resonite.com";
const RESONITE_KEY =
  "oi+ISZuYtMYtpruYHLQLPkXgPaD+IcaRNXPI7b3Z0iYe5+AcccouLYFI9vloMmYEYDlE1PhDL52GsddfxgQeK4Z_hem84t1OXGUdScFkLSMhJA2te86LBL_rFL4JjO4F_hHHIJH1Gm1IYVuvBQjpb89AJ0D6eamd7u4MxeWeEVE=";

// ── Types ──────────────────────────────────────────────────────────────

export interface ResoniteContact {
  id: string;
  contactUsername: string;
  ownerId: string;
  contactStatus: string;
  friendStatus: string;
  isAccepted: boolean;
  profile?: {
    iconUrl?: string;
  };
  latestMessageTime?: string;
  [key: string]: unknown;
}

export interface ResoniteConfig {
  username: string;
  password: string;
  totp?: string;
}

export interface ResoniteClientEvents {
  friendRequest: (contact: ResoniteContact) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

function generateRandomMachineId(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_";
  let result = "";
  for (let i = 0; i < 128; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateUID(): string {
  const data = `resonite-friend-acceptor-${randomBytes(16).toString("base64")}`;
  return createHash("sha256").update(data).digest("hex").toUpperCase();
}

// ── Client ─────────────────────────────────────────────────────────────

export class ResoniteClient extends EventEmitter {
  private config: ResoniteConfig;
  private machineId: string;
  private uid: string;
  private sessionId: string;

  private userId = "";
  private token = "";
  private fullToken = "";
  private tokenExpiry = "";
  private loggedIn = false;

  private connection: signalR.HubConnection | undefined;
  private extendLoginTimer: ReturnType<typeof setInterval> | undefined;
  private statusUpdateTimer: ReturnType<typeof setInterval> | undefined;

  /** Track friend request IDs we've already notified about */
  private knownRequestIds = new Set<string>();

  constructor(config: ResoniteConfig) {
    super();
    this.config = config;
    this.machineId = generateRandomMachineId();
    this.uid = generateUID();
    this.sessionId = randomUUID();
  }

  // ── Auth ───────────────────────────────────────────────────────────

  async login(): Promise<void> {
    const loginData = {
      username: this.config.username,
      authentication: {
        $type: "password",
        password: this.config.password,
      },
      rememberMe: true,
      secretMachineId: this.machineId,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      UID: this.uid,
    };
    if (this.config.totp) {
      headers["TOTP"] = this.config.totp;
    }

    const res = await fetch(`${BASE_API_URL}/userSessions`, {
      method: "POST",
      headers,
      body: JSON.stringify(loginData),
    });

    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(
        `Resonite login failed (${res.status}): ${text}`,
      );
    }

    const loginResponse = await res.json();
    this.userId = loginResponse.entity.userId;
    this.token = loginResponse.entity.token;
    this.fullToken = `res ${this.userId}:${this.token}`;
    this.tokenExpiry = loginResponse.entity.expire;
    this.loggedIn = true;

    console.log(`[Resonite] Logged in as ${this.userId}`);
  }

  async logout(): Promise<void> {
    if (!this.loggedIn) return;
    await this.stop();

    await fetch(
      `${BASE_API_URL}/userSessions/${this.userId}/${this.token}`,
      {
        method: "DELETE",
        headers: { Authorization: this.fullToken },
      },
    );

    this.loggedIn = false;
    this.fullToken = "";
    this.token = "";
    this.userId = "";
    console.log("[Resonite] Logged out");
  }

  // ── SignalR ────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (!this.loggedIn) throw new Error("Not logged in");

    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${BASE_API_URL}/hub`, {
        headers: {
          Authorization: this.fullToken,
          UID: this.machineId,
          SecretClientAccessKey: RESONITE_KEY,
        },
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.connection.onreconnected(() => {
      console.log("[Resonite] SignalR reconnected");
    });

    this.connection.onclose(() => {
      console.log("[Resonite] SignalR disconnected");
      this.emit("disconnected");
    });

    await this.connection.start();
    console.log("[Resonite] SignalR connected");
    this.emit("connected");

    // Periodically extend the login session
    this.extendLoginTimer = setInterval(
      () => void this.extendLogin(),
      600_000,
    );

    // Periodically broadcast online status
    this.statusUpdateTimer = setInterval(
      () => void this.broadcastStatus(),
      90_000,
    );

    // Initial status broadcast
    await this.broadcastStatus();
  }

  async stop(): Promise<void> {
    if (this.extendLoginTimer) clearInterval(this.extendLoginTimer);
    if (this.statusUpdateTimer) clearInterval(this.statusUpdateTimer);
    if (this.connection) {
      await this.connection.stop();
      this.connection = undefined;
    }
  }

  // ── Contacts / Friend Requests ────────────────────────────────────

  /**
   * Poll the contacts list and emit `friendRequest` for any new
   * incoming requests with `friendStatus === "Requested"`.
   */
  async pollFriendRequests(): Promise<void> {
    if (!this.loggedIn) return;

    const res = await fetch(
      `${BASE_API_URL}/users/${this.userId}/contacts`,
      { headers: { Authorization: this.fullToken } },
    );

    if (!res.ok) {
      console.error(
        `[Resonite] Failed to fetch contacts: ${res.status} ${res.statusText}`,
      );
      return;
    }

    const contacts: ResoniteContact[] = await res.json();

    for (const contact of contacts) {
      if (
        contact.friendStatus === "Requested" &&
        !this.knownRequestIds.has(contact.id)
      ) {
        this.knownRequestIds.add(contact.id);
        this.emit("friendRequest", contact);
      }
    }
  }

  /**
   * Accept a friend request by updating the contact via SignalR.
   */
  async acceptFriendRequest(contact: ResoniteContact): Promise<void> {
    if (!this.connection) throw new Error("SignalR not connected");

    const updatedContact = { ...contact, friendStatus: "Accepted" };
    await this.connection.send("UpdateContact", updatedContact);
    console.log(`[Resonite] Accepted friend request from ${contact.contactUsername} (${contact.id})`);
  }

  /**
   * Ignore (decline) a friend request by setting contactStatus to "Ignored".
   */
  async ignoreFriendRequest(contact: ResoniteContact): Promise<void> {
    if (!this.connection) throw new Error("SignalR not connected");

    const updatedContact = { ...contact, contactStatus: "Ignored" };
    await this.connection.send("UpdateContact", updatedContact);
    console.log(`[Resonite] Ignored friend request from ${contact.contactUsername} (${contact.id})`);
  }

  /**
   * Look up a user's public profile by user ID.
   */
  async getUser(userId: string): Promise<Record<string, unknown> | null> {
    const res = await fetch(`${BASE_API_URL}/users/${userId}`);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private async broadcastStatus(): Promise<void> {
    if (!this.connection) return;

    const statusData = {
      userId: this.userId,
      onlineStatus: "Online",
      outputDevice: "Unknown",
      sessionType: "Bot",
      userSessionId: this.sessionId,
      isPresent: true,
      lastPresenceTimestamp: new Date().toISOString(),
      lastStatusChange: new Date().toISOString(),
      compatibilityHash: "resonite-friend-acceptor",
      appVersion: "Resonite Friend Request Acceptor",
      isMobile: false,
    };

    const statusGroup = {
      group: 1,
      targetIds: null,
    };

    await this.connection
      .send("BroadcastStatus", statusData, statusGroup)
      .catch((err) =>
        console.error("[Resonite] Status broadcast failed:", err),
      );
  }

  private async extendLogin(): Promise<void> {
    if (!this.loggedIn) return;

    const expiryMs = Date.parse(this.tokenExpiry);
    if (expiryMs - 600_000 > Date.now()) return;

    console.log("[Resonite] Extending login session...");
    const res = await fetch(`${BASE_API_URL}/userSessions`, {
      method: "PATCH",
      headers: { Authorization: this.fullToken },
    });

    if (res.ok) {
      this.tokenExpiry = new Date(
        Date.now() + 86_400_000,
      ).toISOString();
      console.log("[Resonite] Login session extended");
    } else {
      console.error(
        `[Resonite] Failed to extend login: ${res.status} ${res.statusText}`,
      );
    }
  }

  getUserId(): string {
    return this.userId;
  }
}
