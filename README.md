# Discord ServerManager Bot

An AI-powered Discord bot that allows you to create, edit, save, load, and clone entire Discord server structures (categories, channels, roles, permission overwrites, and custom emojis) using natural language via the Gemini API.

Also includes a client-side layout exporter to clone server configurations from servers you have joined but where the bot is not present.

---

## Features

1. **AI Server Generation (`/create`)**:
   - Creates a new Discord server structure (categories, channels, roles, topics, and permissions) from a natural language prompt.
   - Generates interactive preview embeds before applying changes.

2. **AI Incremental Editing (`/edit`)**:
   - Merges modifications into your current structure without destroying channel history or deleting unaffected elements.
   - Example: *"add a staff-only logging channel to the management category"* or *"make the VIP role gold and hoist it"*.

3. **Template Management (`/save`, `/load`, `/list`, `/delete`)**:
   - Saves complete server templates locally (including custom emojis, which are downloaded and preserved).
   - Rebuilds servers from templates with optional destructive wipes.

4. **Public Layout Importer (`/import`)**:
   - Imports official Discord template links (`https://discord.new/...`) directly into your local template library.

5. **Client-side Exporter (`exporter.js`)**:
   - A browser console utility script that allows you to download layouts of servers you are currently in (no bot required) and save them as JSON templates locally.

---

## Configuration & Setup

### 1. Prerequisites
- Node.js (v18+ recommended, ESM support)
- Discord Bot Token with permissions: `Administrator` (or Manage Channels, Manage Roles, Manage Emojis)
- Gemini API Key

### 2. Configure Environment
Create a `.env` file in the root directory:
```env
DISCORD_TOKEN=your_discord_bot_token
AUTHORIZED_USER_ID=your_discord_user_id
GUILD_ID=your_development_guild_id
CH_LOGS=your_logs_channel_id
CH_SHELL=your_shell_channel_id
CH_CMD=your_command_channel_id
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Installation
```bash
npm install
```

### 4. Register Slash Commands
```bash
npm run register
```

### 5. Start the Bot
```bash
npm run start
```

---

## Slash Commands

- `/create <prompt>`: Generates a brand new server layout matching your description.
- `/edit <prompt>`: Modifies your existing server layout incrementally.
- `/save <name>`: Saves the current server layout and custom emojis to a template.
- `/load <name> [destructive]`: Restores or builds a server layout from a saved template.
- `/list`: Lists all locally saved templates.
- `/delete <name>`: Deletes a saved template.
- `/wipe`: Wipes all channels, roles, and emojis from the server.
- `/import <code> <name>`: Imports a Discord template link into your template folder.
- `/clone <source_id>`: Clones a server where the bot is also present.

---

## Client-Side Layout Exporting (No-Bot Clone)

To clone or backup a server where the bot cannot be invited:
1. Open Discord on your web browser.
2. Open the browser Developer Console (F12 or `Ctrl+Shift+I`).
3. Paste the contents of `exporter.js` into the console and press Enter.
4. Navigate to the server you want to export. The script will dynamically intercept your session authorization headers.
5. Follow the prompt to download the server's layout as a JSON file.
6. Place the JSON file under the `templates/` folder on your bot's host, and apply it with `/load name:<name>`.
