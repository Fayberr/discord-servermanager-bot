import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { ChannelType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

const TEMPLATES_DIR = path.resolve('templates');

const typeToString = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildCategory]: 'category',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildStageVoice]: 'stage'
};

const stringToType = {
  'text': ChannelType.GuildText,
  'voice': ChannelType.GuildVoice,
  'category': ChannelType.GuildCategory,
  'announcement': ChannelType.GuildAnnouncement,
  'forum': ChannelType.GuildForum,
  'stage': ChannelType.GuildStageVoice
};

// Helper to ensure templates directory exists
async function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Serialize the guild state into a template object and download emojis.
 */
export async function saveTemplate(guild, templateName) {
  const targetDir = path.join(TEMPLATES_DIR, templateName);
  const emojisDir = path.join(targetDir, 'emojis');
  
  await ensureDir(targetDir);
  await ensureDir(emojisDir);

  // 1. Serialize Roles
  const roles = [];
  const guildRoles = await guild.roles.fetch();
  for (const [id, role] of guildRoles) {
    if (role.managed || role.name === '@everyone') continue;
    roles.push({
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.toArray()
    });
  }

  // 2. Fetch all channels
  const guildChannels = await guild.channels.fetch();
  
  // Separate categories and other channels
  const categories = [];
  const uncategorizedChannels = [];
  
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
          continue; // Orphaned role overwrite
        }
      } else {
        continue; // Skip user-specific overwrites for templates
      }

      overwrites.push({
        targetName,
        allow: overwrite.allow.toArray(),
        deny: overwrite.deny.toArray()
      });
    }
    return overwrites;
  };

  // Build structure
  for (const [catId, cat] of categoriesCache) {
    const channelsInCat = otherChannels.filter(c => c.parentId === catId);
    const catChannels = [];

    for (const [chanId, chan] of channelsInCat) {
      const typeStr = typeToString[chan.type];
      if (!typeStr) continue;

      catChannels.push({
        name: chan.name,
        type: typeStr,
        topic: chan.topic || null,
        nsfw: chan.nsfw || false,
        rateLimitPerUser: chan.rateLimitPerUser || 0,
        permissionOverwrites: serializeOverwrites(chan)
      });
    }

    categories.push({
      name: cat.name,
      permissionOverwrites: serializeOverwrites(cat),
      channels: catChannels
    });
  }

  // Uncategorized channels
  for (const [chanId, chan] of otherChannels) {
    if (chan.parentId) continue;
    const typeStr = typeToString[chan.type];
    if (!typeStr) continue;

    uncategorizedChannels.push({
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
    const extension = emoji.animated ? 'gif' : 'png';
    const filename = `${emoji.name}.${extension}`;
    const filePath = path.join(emojisDir, filename);

    try {
      const response = await axios({
        url: emoji.url,
        method: 'GET',
        responseType: 'arraybuffer'
      });
      await fs.writeFile(filePath, response.data);
      emojis.push({
        name: emoji.name,
        filename
      });
    } catch (err) {
      console.error(`Failed to download emoji ${emoji.name}:`, err.message);
    }
  }

  const blueprint = {
    version: '1.0.0',
    name: templateName,
    roles,
    categories,
    uncategorizedChannels,
    emojis
  };

  await fs.writeFile(
    path.join(targetDir, 'blueprint.json'),
    JSON.stringify(blueprint, null, 2),
    'utf-8'
  );

  return blueprint;
}

/**
 * Load template JSON.
 */
export async function getTemplate(templateName) {
  const blueprintPath = path.join(TEMPLATES_DIR, templateName, 'blueprint.json');
  if (!existsSync(blueprintPath)) return null;
  const content = await fs.readFile(blueprintPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * List all template names.
 */
export async function listTemplates() {
  await ensureDir(TEMPLATES_DIR);
  const dirs = await fs.readdir(TEMPLATES_DIR, { withFileTypes: true });
  const templates = [];
  for (const dir of dirs) {
    if (dir.isDirectory()) {
      const blueprintPath = path.join(TEMPLATES_DIR, dir.name, 'blueprint.json');
      if (existsSync(blueprintPath)) {
        templates.push(dir.name);
      }
    }
  }
  return templates;
}

/**
 * Delete a template.
 */
export async function deleteTemplate(templateName) {
  const targetDir = path.join(TEMPLATES_DIR, templateName);
  if (existsSync(targetDir)) {
    await fs.rm(targetDir, { recursive: true, force: true });
    return true;
  }
  return false;
}

/**
 * Fetch and import a Discord Server Template from official API by template code or link.
 */
export async function importTemplateFromCode(code, templateName) {
  const url = `https://discord.com/api/v10/guilds/templates/${code}`;
  const response = await axios.get(url);
  const data = response.data;
  
  if (!data || !data.serialized_source_guild) {
    throw new Error('Invalid template data returned from Discord API.');
  }
  
  const sg = data.serialized_source_guild;
  
  // 1. Map Roles
  const roles = [];
  const tempRoleMap = new Map(); // to map temp ID -> Role Name
  
  for (const role of sg.roles || []) {
    if (role.name === '@everyone') {
      tempRoleMap.set(role.id, '@everyone');
      continue;
    }
    
    const permArray = new PermissionsBitField(BigInt(role.permissions)).toArray();
    roles.push({
      name: role.name,
      color: `#${role.color.toString(16).padStart(6, '0')}`,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: permArray
    });
    tempRoleMap.set(role.id, role.name);
  }
  
  // 2. Map channels
  const categories = [];
  const uncategorizedChannels = [];
  
  const sgChannels = sg.channels || [];
  const sgCategories = sgChannels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
  const sgOthers = sgChannels.filter(c => c.type !== 4).sort((a, b) => a.position - b.position);
  
  const typeMapStr = {
    0: 'text',
    2: 'voice',
    5: 'announcement',
    13: 'stage',
    15: 'forum'
  };
  
  const parseOverwrites = (owList) => {
    return (owList || []).map(ow => {
      const targetName = tempRoleMap.get(ow.id) || '@everyone';
      const allowArr = new PermissionsBitField(BigInt(ow.allow)).toArray();
      const denyArr = new PermissionsBitField(BigInt(ow.deny)).toArray();
      return {
        targetName,
        allow: allowArr,
        deny: denyArr
      };
    }).filter(ow => ow.targetName !== '@everyone' || (ow.allow.length > 0 || ow.deny.length > 0));
  };
  
  // Group categories
  for (const cat of sgCategories) {
    const childChans = sgOthers.filter(c => c.parent_id === cat.id);
    const channelsList = [];
    
    for (const chan of childChans) {
      const typeStr = typeMapStr[chan.type] || 'text';
      channelsList.push({
        name: chan.name,
        type: typeStr,
        topic: chan.topic || null,
        nsfw: chan.nsfw || false,
        rateLimitPerUser: chan.rate_limit_per_user || 0,
        permissionOverwrites: parseOverwrites(chan.permission_overwrites)
      });
    }
    
    categories.push({
      name: cat.name,
      permissionOverwrites: parseOverwrites(cat.permission_overwrites),
      channels: channelsList
    });
  }
  
  // Group uncategorized
  for (const chan of sgOthers) {
    if (chan.parent_id !== null && sgCategories.some(cat => cat.id === chan.parent_id)) continue;
    const typeStr = typeMapStr[chan.type] || 'text';
    uncategorizedChannels.push({
      name: chan.name,
      type: typeStr,
      topic: chan.topic || null,
      nsfw: chan.nsfw || false,
      rateLimitPerUser: chan.rate_limit_per_user || 0,
      permissionOverwrites: parseOverwrites(chan.permission_overwrites)
    });
  }
  
  const blueprint = {
    version: '1.0.0',
    name: templateName,
    roles,
    categories,
    uncategorizedChannels,
    emojis: [] // Templates from code do not have custom emojis included
  };
  
  const targetDir = path.join(TEMPLATES_DIR, templateName);
  await ensureDir(targetDir);
  
  await fs.writeFile(
    path.join(targetDir, 'blueprint.json'),
    JSON.stringify(blueprint, null, 2),
    'utf-8'
  );
  
  return blueprint;
}
