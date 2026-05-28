import dotenv from 'dotenv';
dotenv.config();

/**
 * Sends a log message to the console and to the configured Discord logs channel.
 * @param {import('discord.js').Client} client The Discord client.
 * @param {string} message The log message text.
 * @param {'info' | 'warn' | 'error' | 'success'} level The severity level.
 */
export async function logMessage(client, message, level = 'info') {
  const timestamp = new Date().toISOString();
  const consolePrefix = `[${timestamp}] [${level.toUpperCase()}]`;

  // Console output
  if (level === 'error') {
    console.error(`${consolePrefix} ${message}`);
  } else if (level === 'warn') {
    console.warn(`${consolePrefix} ${message}`);
  } else {
    console.log(`${consolePrefix} ${message}`);
  }

  // Discord Channel output
  const channelId = process.env.CH_LOGS;
  if (!channelId) return;

  try {
    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      let emoji = 'ℹ️';
      if (level === 'warn') emoji = '⚠️';
      if (level === 'error') emoji = '🚨';
      if (level === 'success') emoji = '✅';

      await channel.send(`\`[${timestamp.split('T')[1].slice(0, 8)}]\` ${emoji} **[${level.toUpperCase()}]** ${message}`);
    }
  } catch (err) {
    console.error(`[Logger Fail] Failed to send log to Discord channel ${channelId}:`, err.message);
  }
}
