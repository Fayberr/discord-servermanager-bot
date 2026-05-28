import { ChannelType } from 'discord.js';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import axios from 'axios';

/**
 * Executes a diff plan on the given Discord guild.
 * @param {import('discord.js').Guild} guild The guild to apply changes to.
 * @param {Object} diff The calculated differences.
 * @param {Object} options Configuration options.
 * @param {string} options.templateName Optional name of template to load emojis from.
 * @returns {Promise<void>}
 */
export async function applyDiff(guild, diff, options = {}) {
  const { templateName = null } = options;

  // Cache to map names to objects/IDs
  const roleMap = new Map();
  const categoryMap = new Map();

  // ====================
  // 0. DELETE EMOJIS
  // ====================
  if (diff.emojis && diff.emojis.toDelete) {
    for (const delEmoji of diff.emojis.toDelete) {
      try {
        const emoji = guild.emojis.cache.get(delEmoji.id);
        if (emoji) {
          await emoji.delete('AI/Template Re-organization (Wipe)');
        }
      } catch (err) {
        console.error(`Failed to delete emoji ${delEmoji.name}:`, err.message);
      }
    }
  }

  // ====================
  // 1. DELETE CHANNELS
  // ====================
  for (const delChan of diff.channels.toDelete) {
    try {
      const channel = guild.channels.cache.get(delChan.id);
      if (channel && channel.deletable) {
        await channel.delete('AI/Template Re-organization');
      }
    } catch (err) {
      console.error(`Failed to delete channel ${delChan.name}:`, err.message);
    }
  }

  // ====================
  // 2. DELETE CATEGORIES
  // ====================
  for (const delCat of diff.categories.toDelete) {
    try {
      const category = guild.channels.cache.get(delCat.id);
      if (category && category.deletable) {
        await category.delete('AI/Template Re-organization');
      }
    } catch (err) {
      console.error(`Failed to delete category ${delCat.name}:`, err.message);
    }
  }

  // ====================
  // 3. DELETE ROLES
  // ====================
  for (const delRole of diff.roles.toDelete) {
    try {
      const role = guild.roles.cache.get(delRole.id);
      if (role && role.editable && role.name !== '@everyone') {
        await role.delete('AI/Template Re-organization');
      }
    } catch (err) {
      console.error(`Failed to delete role ${delRole.name}:`, err.message);
    }
  }

  // ====================
  // 4. CREATE ROLES
  // ====================
  for (const creRole of diff.roles.toCreate) {
    try {
      const colorClean = creRole.color ? creRole.color.replace('#', '') : undefined;
      const role = await guild.roles.create({
        name: creRole.name,
        color: colorClean ? parseInt(colorClean, 16) : undefined,
        hoist: creRole.hoist,
        mentionable: creRole.mentionable,
        permissions: creRole.permissions,
        reason: 'AI/Template Re-organization'
      });
      roleMap.set(role.name.toLowerCase(), role);
    } catch (err) {
      console.error(`Failed to create role ${creRole.name}:`, err.message);
    }
  }

  // ====================
  // 5. UPDATE ROLES
  // ====================
  for (const updRole of diff.roles.toUpdate) {
    try {
      const role = guild.roles.cache.get(updRole.id);
      if (role && role.editable) {
        const colorClean = updRole.color ? updRole.color.replace('#', '') : undefined;
        const updatedRole = await role.edit({
          name: updRole.name,
          color: colorClean ? parseInt(colorClean, 16) : undefined,
          hoist: updRole.hoist,
          mentionable: updRole.mentionable,
          permissions: updRole.permissions
        });
        roleMap.set(updatedRole.name.toLowerCase(), updatedRole);
      }
    } catch (err) {
      console.error(`Failed to update role ${updRole.name}:`, err.message);
    }
  }

  // Fill roleMap with any existing roles that weren't modified
  const currentRoles = await guild.roles.fetch();
  for (const [id, role] of currentRoles) {
    const key = role.name.toLowerCase();
    if (!roleMap.has(key)) {
      roleMap.set(key, role);
    }
  }
  // Add everyone explicitly
  roleMap.set('@everyone', guild.roles.everyone);

  // ====================
  // 6. UPLOAD EMOJIS (IF TEMPLATE)
  // ====================
  if (templateName) {
    const emojisDir = path.resolve('templates', templateName, 'emojis');
    if (existsSync(emojisDir)) {
      try {
        const files = await fs.readdir(emojisDir);
        // Fetch current emojis to avoid duplicates
        const currentEmojis = await guild.emojis.fetch();
        const currentEmojiNames = new Set(currentEmojis.map(e => e.name));

        for (const file of files) {
          const emojiName = path.parse(file).name;
          if (currentEmojiNames.has(emojiName)) continue; // skip duplicates
          
          const filePath = path.join(emojisDir, file);
          try {
            await guild.emojis.create({
              attachment: filePath,
              name: emojiName,
              reason: 'AI/Template Re-organization'
            });
          } catch (emojiErr) {
            console.error(`Failed to upload emoji ${emojiName}:`, emojiErr.message);
          }
        }
      } catch (err) {
        console.error('Error handling template emojis:', err.message);
      }
    }
  } else if (options.sourceGuild) {
    try {
      const sourceEmojis = await options.sourceGuild.emojis.fetch();
      const currentEmojis = await guild.emojis.fetch();
      const currentEmojiNames = new Set(currentEmojis.map(e => e.name));

      for (const [id, emoji] of sourceEmojis) {
        if (currentEmojiNames.has(emoji.name)) continue;
        
        try {
          const response = await axios({
            url: emoji.url,
            method: 'GET',
            responseType: 'arraybuffer'
          });
          
          await guild.emojis.create({
            attachment: response.data,
            name: emoji.name,
            reason: 'AI/Template Re-organization (Clone)'
          });
        } catch (emojiErr) {
          console.error(`Failed to copy emoji ${emoji.name}:`, emojiErr.message);
        }
      }
    } catch (err) {
      console.error('Error copying emojis from source guild:', err.message);
    }
  }

  // ====================
  // 7. CREATE CATEGORIES
  // ====================
  for (const creCat of diff.categories.toCreate) {
    try {
      const category = await guild.channels.create({
        name: creCat.name,
        type: ChannelType.GuildCategory,
        reason: 'AI/Template Re-organization'
      });
      categoryMap.set(category.name.toLowerCase(), category);
    } catch (err) {
      console.error(`Failed to create category ${creCat.name}:`, err.message);
    }
  }

  // Fill categoryMap with existing categories
  const currentChannels = await guild.channels.fetch();
  for (const [id, chan] of currentChannels) {
    if (chan.type === ChannelType.GuildCategory) {
      const key = chan.name.toLowerCase();
      if (!categoryMap.has(key)) {
        categoryMap.set(key, chan);
      }
    }
  }

  // Helper to compile overwrites using roleMap
  const compileOverwrites = (permissionOverwrites) => {
    return (permissionOverwrites || []).map(ow => {
      let targetId;
      if (ow.targetName === '@everyone') {
        targetId = guild.roles.everyone.id;
      } else {
        const role = roleMap.get(ow.targetName.toLowerCase());
        targetId = role ? role.id : null;
      }
      
      if (!targetId) return null;
      
      return {
        id: targetId,
        allow: ow.allow,
        deny: ow.deny
      };
    }).filter(Boolean);
  };

  // Helper: Create Channel with fallbacks for unsupported types and automod blocks
  const createChannelWithRetry = async (creChan) => {
    const typeMap = {
      'text': ChannelType.GuildText,
      'voice': ChannelType.GuildVoice,
      'announcement': ChannelType.GuildAnnouncement,
      'forum': ChannelType.GuildForum,
      'stage': ChannelType.GuildStageVoice
    };

    let discordType = typeMap[creChan.type] || ChannelType.GuildText;
    let parentId = null;
    if (creChan.categoryName) {
      const parentCat = categoryMap.get(creChan.categoryName.toLowerCase());
      if (parentCat) parentId = parentCat.id;
    }

    const options = {
      name: creChan.name,
      type: discordType,
      topic: creChan.topic || undefined,
      nsfw: creChan.nsfw || undefined,
      rateLimitPerUser: creChan.rateLimitPerUser || undefined,
      parent: parentId,
      permissionOverwrites: compileOverwrites(creChan.permissionOverwrites),
      reason: 'AI/Template Re-organization'
    };

    try {
      return await guild.channels.create(options);
    } catch (err) {
      const errMsg = err.message.toLowerCase();
      
      // 1. Fallback for unsupported channel type (e.g. news/announcement/forum/stage on non-community guild)
      if (errMsg.includes('base_type_choices') || errMsg.includes('type') || errMsg.includes('value must be one of')) {
        const fallbackType = (creChan.type === 'voice' || creChan.type === 'stage') 
          ? ChannelType.GuildVoice 
          : ChannelType.GuildText;
        
        console.warn(`[Fallback] Guild does not support type '${creChan.type}' for channel '${creChan.name}'. Retrying as '${fallbackType === ChannelType.GuildVoice ? 'voice' : 'text'}'.`);
        options.type = fallbackType;
        try {
          return await guild.channels.create(options);
        } catch (retryErr) {
          err = retryErr;
        }
      }

      // 2. Fallback for Automod block in topic
      if (err.message.toLowerCase().includes('topic') || err.message.toLowerCase().includes('word') || err.message.toLowerCase().includes('not allowed')) {
        console.warn(`[Fallback] Channel topic/description for '${creChan.name}' was blocked by Discord filters. Retrying without topic.`);
        options.topic = undefined;
        try {
          return await guild.channels.create(options);
        } catch (retryErr) {
          err = retryErr;
        }
      }

      throw err;
    }
  };

  // Helper: Edit Channel with fallbacks for Automod blocks
  const editChannelWithRetry = async (channel, updChan) => {
    let parentId = null;
    if (updChan.categoryName) {
      const parentCat = categoryMap.get(updChan.categoryName.toLowerCase());
      if (parentCat) parentId = parentCat.id;
    }

    const options = {
      name: updChan.name,
      topic: updChan.topic || null,
      nsfw: updChan.nsfw || false,
      rateLimitPerUser: updChan.rateLimitPerUser || 0,
      parent: parentId,
      permissionOverwrites: compileOverwrites(updChan.permissionOverwrites)
    };

    try {
      return await channel.edit(options);
    } catch (err) {
      if (err.message.toLowerCase().includes('topic') || err.message.toLowerCase().includes('word') || err.message.toLowerCase().includes('not allowed')) {
        console.warn(`[Fallback] Edited topic for channel '${updChan.name}' was blocked by Discord filters. Retrying without topic.`);
        options.topic = null;
        return await channel.edit(options);
      }
      throw err;
    }
  };

  // ====================
  // 8. CREATE CHANNELS
  // ====================
  for (const creChan of diff.channels.toCreate) {
    try {
      await createChannelWithRetry(creChan);
    } catch (err) {
      console.error(`Failed to create channel ${creChan.name}:`, err.message);
    }
  }

  // ====================
  // 9. UPDATE CATEGORIES
  // ====================
  for (const updCat of diff.categories.toUpdate) {
    try {
      const category = guild.channels.cache.get(updCat.id);
      if (category) {
        await category.edit({
          name: updCat.name,
          permissionOverwrites: compileOverwrites(updCat.permissionOverwrites)
        });
      }
    } catch (err) {
      console.error(`Failed to update category ${updCat.name}:`, err.message);
    }
  }

  // ====================
  // 10. UPDATE CHANNELS (PROPERTIES & PERMISSIONS)
  // ====================
  for (const updChan of diff.channels.toUpdate) {
    try {
      const channel = guild.channels.cache.get(updChan.id);
      if (channel) {
        await editChannelWithRetry(channel, updChan);
      }
    } catch (err) {
      console.error(`Failed to update channel ${updChan.name}:`, err.message);
    }
  }

  // Apply permission overwrites for newly created categories as well
  for (const creCat of diff.categories.toCreate) {
    try {
      const category = categoryMap.get(creCat.name.toLowerCase());
      if (category && creCat.permissionOverwrites && creCat.permissionOverwrites.length > 0) {
        await category.edit({
          permissionOverwrites: compileOverwrites(creCat.permissionOverwrites)
        });
      }
    } catch (err) {
      console.error(`Failed to apply permissions to category ${creCat.name}:`, err.message);
    }
  }
}
