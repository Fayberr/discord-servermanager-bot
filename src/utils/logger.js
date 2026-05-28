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

}
