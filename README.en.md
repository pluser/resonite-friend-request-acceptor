# Resonite Friend Request Acceptor

[日本語版 README はこちら / Japanese README](./README.md)

A bot that forwards Resonite friend requests to Discord and lets you Accept / Ignore them via Discord buttons.

## Features

- Logs in to the Resonite API and maintains an online presence via SignalR
- Detects new friend requests instantly through SignalR real-time events (with polling fallback)
- Sends friend request notifications to a specified Discord channel as Embeds with buttons
- **Accept** button on Discord to approve friend requests
- **Ignore** button on Discord to reject friend requests
- After a button action, the Embed is updated with the result and buttons are disabled

### Slash Commands

| Command | Description |
|---|---|
| `/friends` | Display the Resonite friends list |
| `/requests` | Display pending and ignored friend requests |
| `/accept user_id:<ID>` | Accept a previously ignored friend request (e.g. `/accept user_id:U-someone`) |

## Setup

### Prerequisites

- Node.js 18 or later
- Discord Bot Token (create one at the [Discord Developer Portal](https://discord.com/developers/applications))
- Resonite account credentials

### Preparing the Discord Bot

1. Create a new Application on the [Discord Developer Portal](https://discord.com/developers/applications)
2. Obtain the Bot Token from the Bot tab
3. In OAuth2 > URL Generator, select the `bot` and `applications.commands` scopes and grant the following permissions:
   - Send Messages
   - Embed Links
   - Read Message History
   - Use Slash Commands
4. Invite the bot to your server using the generated URL
5. Get the ID of the text channel where you want notifications sent (right-click the channel > Copy ID)

### Installation

```bash
git clone <repository-url>
cd resonite-friend-request-acceptor
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

```env
# Resonite credentials
RESONITE_USERNAME=your_resonite_username
RESONITE_PASSWORD=your_resonite_password
RESONITE_TOTP=          # Set only if 2FA is enabled

# Discord bot
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=your_channel_id

# Polling interval (seconds, default: 60)
POLL_INTERVAL_SECONDS=60
```

### Running

```bash
# Build & run
npm run build
npm start

# Development (direct execution via tsx)
npm run dev
```

### Running with Docker

You can pull and run the image from GitHub Container Registry:

```bash
docker run -d --name resonite-friend-acceptor \
  -e RESONITE_USERNAME=your_resonite_username \
  -e RESONITE_PASSWORD=your_resonite_password \
  -e RESONITE_TOTP= \
  -e DISCORD_TOKEN=your_discord_bot_token \
  -e DISCORD_CHANNEL_ID=your_channel_id \
  -e POLL_INTERVAL_SECONDS=60 \
  ghcr.io/<owner>/resonite-friend-request-acceptor:main
```

Or using an `.env` file:

```bash
docker run -d --name resonite-friend-acceptor \
  --env-file .env \
  ghcr.io/<owner>/resonite-friend-request-acceptor:main
```

To build the image locally:

```bash
docker build -t resonite-friend-request-acceptor .
docker run -d --env-file .env resonite-friend-request-acceptor
```

### CI/CD

The following pipelines run automatically via GitHub Actions:

1. **test** — Runs type checking, tests, and builds on Node.js 20/22
2. **docker** — After tests pass, builds a Docker image and pushes it to GitHub Container Registry (`ghcr.io`)

When you push a tag (e.g. `v1.0.0`), semantic versioning tags are automatically applied.

## Architecture

```
┌─────────────────┐     ┌───────────────────┐     ┌─────────────────┐
│   Resonite API  │◄────│   ResoniteClient  │────►│   DiscordBot    │
│   (REST+SignalR)│     │  - login/auth     │     │  - notify embed │
│                 │     │  - real-time event│     │  - Accept btn   │
│                 │     │  - poll contacts  │     │  - Ignore btn   │
│                 │     │  - accept/ignore  │     │  - /friends     │
│                 │     │  - get contacts   │     │  - /requests    │
│                 │     │                   │     │  - /accept      │
└─────────────────┘     └───────────────────┘     └─────────────────┘
                              ▲                         │
                              │   accept/ignore         │
                              └─────────────────────────┘
                              button click / slash cmd
```

1. `ResoniteClient` logs in to the Resonite API and maintains a connection via SignalR
2. Friend requests are detected in real time through the `ContactAddedOrUpdated` SignalR event (with polling fallback)
3. When a new request is detected, `DiscordBot` sends a notification to the Discord channel
4. The user clicks an Accept/Ignore button on Discord, or uses a slash command
5. The friend status on the Resonite side is updated via SignalR's `UpdateContact`

## References

- [mvcontact-bot](https://github.com/Lexevolution/mvcontact-bot) - Resonite chat bot module (Node.js)
- [Resonite API Wiki](https://wiki.resonite.com/API) - Official API documentation
- [resonitepy](https://github.com/brodokk/resonitepy) - Python Resonite API library

## License

MIT
