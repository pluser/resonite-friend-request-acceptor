# Resonite Friend Request Acceptor

Resonite に届くフレンドリクエストを Discord に転送し、Discord 上のボタンから Accept / Ignore できるボットです。

## 機能

- Resonite API にログインし、SignalR 経由でオンライン状態を維持
- 定期的にコンタクトリストをポーリングし、新しいフレンドリクエストを検出
- Discord の指定チャンネルにフレンドリクエスト通知を Embed + ボタン付きで送信
- Discord 上の **Accept** ボタンでフレンドリクエストを承認
- Discord 上の **Ignore** ボタンでフレンドリクエストを拒否
- ボタン操作後は結果が Embed に反映され、ボタンは無効化される

## セットアップ

### 前提条件

- Node.js 18 以上
- Discord Bot Token（[Discord Developer Portal](https://discord.com/developers/applications) で作成）
- Resonite アカウントの認証情報

### Discord Bot の準備

1. [Discord Developer Portal](https://discord.com/developers/applications) で新しい Application を作成
2. Bot タブで Bot Token を取得
3. OAuth2 > URL Generator で `bot` スコープを選択し、以下の権限を付与:
   - Send Messages
   - Embed Links
   - Read Message History
4. 生成された URL でボットをサーバーに招待
5. 通知を送りたいテキストチャンネルの ID を取得（チャンネルを右クリック > ID をコピー）

### インストール

```bash
git clone <repository-url>
cd resonite-friend-request-acceptor
npm install
```

### 設定

`.env.example` をコピーして `.env` を作成し、必要な値を設定します:

```bash
cp .env.example .env
```

```env
# Resonite credentials
RESONITE_USERNAME=your_resonite_username
RESONITE_PASSWORD=your_resonite_password
RESONITE_TOTP=          # 2FA有効時のみ設定

# Discord bot
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=your_channel_id

# ポーリング間隔（秒、デフォルト: 60）
POLL_INTERVAL_SECONDS=60
```

### 実行

```bash
# ビルド & 実行
npm run build
npm start

# 開発時（tsx による直接実行）
npm run dev
```

### Docker で実行

GitHub Container Registry からイメージを取得して実行できます:

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

または `.env` ファイルを使って:

```bash
docker run -d --name resonite-friend-acceptor \
  --env-file .env \
  ghcr.io/<owner>/resonite-friend-request-acceptor:main
```

ローカルでイメージをビルドする場合:

```bash
docker build -t resonite-friend-request-acceptor .
docker run -d --env-file .env resonite-friend-request-acceptor
```

### CI/CD

GitHub Actions で以下のパイプラインが自動実行されます:

1. **test** — Node.js 20/22 で型チェック・テスト・ビルドを実行
2. **docker** — テスト通過後に Docker イメージをビルドし、GitHub Container Registry (`ghcr.io`) にプッシュ

タグ (`v1.0.0` 等) をプッシュすると、セマンティックバージョニングに基づいたタグが自動付与されます。

## アーキテクチャ

```
┌─────────────────┐     ┌───────────────────┐     ┌─────────────────┐
│   Resonite API  │◄────│   ResoniteClient  │────►│   DiscordBot    │
│   (REST+SignalR)│     │  - login/auth     │     │  - notify embed │
│                 │     │  - poll contacts  │     │  - Accept btn   │
│                 │     │  - accept/ignore  │     │  - Ignore btn   │
└─────────────────┘     └───────────────────┘     └─────────────────┘
                              ▲                         │
                              │   accept/ignore         │
                              └─────────────────────────┘
                                  button click
```

1. `ResoniteClient` が Resonite API にログインし、SignalR で接続を維持
2. 定期的に `GET /users/{userId}/contacts` をポーリングし、`friendStatus === "Requested"` のコンタクトを検出
3. 新しいリクエストを検出すると `DiscordBot` が Discord チャンネルに通知を送信
4. ユーザーが Discord 上で Accept/Ignore ボタンをクリック
5. SignalR の `UpdateContact` で Resonite 側のフレンド状態を更新

## 参考

- [mvcontact-bot](https://github.com/Lexevolution/mvcontact-bot) - Resonite chat bot module (Node.js)
- [Resonite API Wiki](https://wiki.resonite.com/API) - 公式 API ドキュメント
- [resonitepy](https://github.com/brodokk/resonitepy) - Python Resonite API library

## ライセンス

MIT
