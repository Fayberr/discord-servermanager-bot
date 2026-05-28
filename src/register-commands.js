import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.DISCORD_TOKEN) {
  console.error('Error: DISCORD_TOKEN is missing in the environment/dotenv file.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('create')
    .setDescription('Create a brand new server layout using Gemini AI')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('Description of the server theme, roles, and channels')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('edit')
    .setDescription('Edit the current server layout using Gemini AI')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('Description of the modifications to make')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('save')
    .setDescription('Save the current server as a template')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Name of the template')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('load')
    .setDescription('Load a server template')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Name of the template')
        .setRequired(true)
        .setAutocomplete(true))
    .addBooleanOption(option =>
      option.setName('destructive')
        .setDescription('Whether to delete existing channels and roles (default: true)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('List all saved templates'),

  new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Delete a saved template')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Name of the template')
        .setRequired(true)
        .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('wipe')
    .setDescription('Completely wipe the current server channels, categories, roles, and emojis to a clean slate'),

  new SlashCommandBuilder()
    .setName('import')
    .setDescription('Import a public Discord server template using a template link or code')
    .addStringOption(option =>
      option.setName('code')
        .setDescription('Template code or full link (e.g. discord.new/abc or abc)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Name to save the imported template as')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('clone')
    .setDescription('Clone another server layout directly using its Server (Guild) ID')
    .addStringOption(option =>
      option.setName('source_id')
        .setDescription('The ID of the server to clone from')
        .setRequired(true))
    .addBooleanOption(option =>
      option.setName('destructive')
        .setDescription('Whether to wipe the current server before cloning (default: true)')
        .setRequired(false))
].map(command => command.toJSON());

// Decode client ID from bot token (1st segment of the token is base64 client ID)
let clientId;
try {
  const tokenParts = process.env.DISCORD_TOKEN.split('.');
  clientId = Buffer.from(tokenParts[0], 'base64').toString('utf-8');
} catch (e) {
  console.error('Failed to decode Client ID from token. Please ensure your token is valid.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    console.log('Registering global commands...');
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands },
    );
    console.log('Successfully registered global commands.');
    if (process.env.GUILD_ID) {
      try {
        console.log(`Registering guild-specific commands for Guild ID: ${process.env.GUILD_ID}`);
        await rest.put(
          Routes.applicationGuildCommands(clientId, process.env.GUILD_ID),
          { body: commands },
        );
        console.log('Successfully registered guild-specific commands.');
      } catch (guildErr) {
        console.warn(`Note: Could not register guild-specific commands for Guild ID ${process.env.GUILD_ID} (${guildErr.message}). Bot may not be in this guild yet.`);
      }
    }

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
})();
