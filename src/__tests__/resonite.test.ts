import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResoniteClient, type ResoniteContact } from "../resonite.js";

describe("ResoniteClient", () => {
  it("should be instantiable with valid config", () => {
    const client = new ResoniteClient({
      username: "testuser",
      password: "testpass",
    });
    expect(client).toBeInstanceOf(ResoniteClient);
  });

  it("should accept optional TOTP config", () => {
    const client = new ResoniteClient({
      username: "testuser",
      password: "testpass",
      totp: "123456",
    });
    expect(client).toBeInstanceOf(ResoniteClient);
  });

  it("should throw when starting without login", async () => {
    const client = new ResoniteClient({
      username: "testuser",
      password: "testpass",
    });
    await expect(client.start()).rejects.toThrow("Not logged in");
  });

  it("should emit friendRequest events for new requested contacts", async () => {
    const client = new ResoniteClient({
      username: "testuser",
      password: "testpass",
    });

    // Mock the internal state to simulate logged-in
    (client as any).loggedIn = true;
    (client as any).userId = "U-testuser";
    (client as any).fullToken = "res U-testuser:faketoken";

    const mockContacts: ResoniteContact[] = [
      {
        id: "U-friend1",
        contactUsername: "Friend1",
        ownerId: "U-testuser",
        contactStatus: "Requested",
        friendStatus: "Requested",
        isAccepted: false,
      },
      {
        id: "U-friend2",
        contactUsername: "Friend2",
        ownerId: "U-testuser",
        contactStatus: "Accepted",
        friendStatus: "Accepted",
        isAccepted: true,
      },
    ];

    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockContacts),
    });
    vi.stubGlobal("fetch", mockFetch);

    const emitted: ResoniteContact[] = [];
    client.on("friendRequest", (contact: ResoniteContact) => {
      emitted.push(contact);
    });

    await client.pollFriendRequests();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.id).toBe("U-friend1");
    expect(emitted[0]!.contactUsername).toBe("Friend1");

    vi.unstubAllGlobals();
  });

  it("should not re-emit for already-known request IDs", async () => {
    const client = new ResoniteClient({
      username: "testuser",
      password: "testpass",
    });

    (client as any).loggedIn = true;
    (client as any).userId = "U-testuser";
    (client as any).fullToken = "res U-testuser:faketoken";

    const mockContacts: ResoniteContact[] = [
      {
        id: "U-friend1",
        contactUsername: "Friend1",
        ownerId: "U-testuser",
        contactStatus: "Requested",
        friendStatus: "Requested",
        isAccepted: false,
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockContacts),
    });
    vi.stubGlobal("fetch", mockFetch);

    const emitted: ResoniteContact[] = [];
    client.on("friendRequest", (contact: ResoniteContact) => {
      emitted.push(contact);
    });

    // Poll twice — second time should not re-emit
    await client.pollFriendRequests();
    await client.pollFriendRequests();

    expect(emitted).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it("should handle fetch failure gracefully", async () => {
    const client = new ResoniteClient({
      username: "testuser",
      password: "testpass",
    });

    (client as any).loggedIn = true;
    (client as any).userId = "U-testuser";
    (client as any).fullToken = "res U-testuser:faketoken";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    vi.stubGlobal("fetch", mockFetch);

    const emitted: ResoniteContact[] = [];
    client.on("friendRequest", (contact: ResoniteContact) => {
      emitted.push(contact);
    });

    // Should not throw
    await client.pollFriendRequests();
    expect(emitted).toHaveLength(0);

    vi.unstubAllGlobals();
  });
});
