import { ChannelType } from 'discord.js';

const typeToString = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildCategory]: 'category',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildStageVoice]: 'stage'
};

/**
 * Serializes the current state of a Discord Guild into a standard blueprint.
 * @param {import('discord.js').Guild} guild 
 * @returns {Promise<Object>} The serialized guild state.
 */
export async function serializeGuild(guild) {
  // 1. Fetch Roles
  const roles = [];
  const guildRoles = await guild.roles.fetch();
  for (const [id, role] of guildRoles) {
    if (role.managed || role.name === '@everyone') continue;
    roles.push({
      id: role.id, // Keep ID in serialization to help with local diffing
      name: role.name,
      color: `#${role.color.toString(16).padStart(6, '0')}`,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.toArray()
    });
  }

  // 2. Fetch Channels
  const guildChannels = await guild.channels.fetch();
  
  // Sort categories and other channels
  const categoriesCache = guildChannels.filter(c => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  const otherChannels = guildChannels.filter(c => c.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position);

  // Helper to serialize overwrites
  const serializeOverwrites = (channel) => {
    const overwrites = [];
    for (const [id, overwrite] of channel.permissionOverwrites.cache) {
      let targetName = '';
      if (overwrite.type === 0) { // Role
        const role = guild.roles.cache.get(id);
        if (role) {
          targetName = role.name;
        } else {
          continue;
        }
      } else {
        continue; // Skip user-specific overwrites
      }

      overwrites.push({
        targetName,
        allow: overwrite.allow.toArray(),
        deny: overwrite.deny.toArray()
      });
    }
    return overwrites;
  };

  const categories = [];
  const uncategorizedChannels = [];

  for (const [catId, cat] of categoriesCache) {
    const channelsInCat = otherChannels.filter(c => c.parentId === catId);
    const catChannels = [];

    for (const [chanId, chan] of channelsInCat) {
      const typeStr = typeToString[chan.type];
      if (!typeStr) continue;

      catChannels.push({
        id: chan.id,
        name: chan.name,
        type: typeStr,
        topic: chan.topic || null,
        nsfw: chan.nsfw || false,
        rateLimitPerUser: chan.rateLimitPerUser || 0,
        permissionOverwrites: serializeOverwrites(chan)
      });
    }

    categories.push({
      id: cat.id,
      name: cat.name,
      permissionOverwrites: serializeOverwrites(cat),
      channels: catChannels
    });
  }

  for (const [chanId, chan] of otherChannels) {
    if (chan.parentId) continue;
    const typeStr = typeToString[chan.type];
    if (!typeStr) continue;

    uncategorizedChannels.push({
      id: chan.id,
      name: chan.name,
      type: typeStr,
      topic: chan.topic || null,
      nsfw: chan.nsfw || false,
      rateLimitPerUser: chan.rateLimitPerUser || 0,
      permissionOverwrites: serializeOverwrites(chan)
    });
  }

  // 3. Emojis
  const emojis = [];
  const guildEmojis = await guild.emojis.fetch();
  for (const [id, emoji] of guildEmojis) {
    emojis.push({
      id: emoji.id,
      name: emoji.name,
      url: emoji.url
    });
  }

  return {
    version: '1.0.0',
    roles,
    categories,
    uncategorizedChannels,
    emojis
  };
}
