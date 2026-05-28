/**
 * Discord Server Layout Exporter (Interactive Interceptor)
 * 
 * INSTRUCTIONS:
 * 1. Open Discord in your Web Browser (https://discord.com/channels/@me).
 * 2. Navigate to the server you want to clone.
 * 3. Press F12 and open the "Console" tab.
 * 4. Paste this entire script and press Enter.
 * 5. If it doesn't download immediately, just click on any channel in the server sidebar.
 * 6. The script will intercept the authorization token from the network request,
 *    and automatically download 'blueprint.json'.
 * 7. Place this file in: /home/fayber/discord-servermanager-bot/templates/<template_name>/blueprint.json
 * 8. Run the bot command: /load name:<template_name>
 */

(async () => {
  const PERMISSION_FLAGS = {
    1n: 'CreateInstantInvite',
    2n: 'KickMembers',
    4n: 'BanMembers',
    8n: 'Administrator',
    16n: 'ManageChannels',
    32n: 'ManageGuild',
    64n: 'AddReactions',
    128n: 'ViewAuditLog',
    256n: 'PrioritySpeaker',
    512n: 'Stream',
    1024n: 'ViewChannel',
    2048n: 'SendMessages',
    4096n: 'SendTTSMessages',
    8192n: 'ManageMessages',
    16384n: 'EmbedLinks',
    32768n: 'AttachFiles',
    65536n: 'ReadMessageHistory',
    131072n: 'MentionEveryone',
    262144n: 'UseExternalEmojis',
    524288n: 'ViewGuildInsights',
    1048576n: 'Connect',
    2097152n: 'Speak',
    4194304n: 'MuteMembers',
    8388608n: 'DeafenMembers',
    16777216n: 'MoveMembers',
    33554432n: 'UseVAD',
    67108864n: 'ChangeNickname',
    134217728n: 'ManageNicknames',
    268435456n: 'ManageRoles',
    536870912n: 'ManageWebhooks',
    1073741824n: 'ManageEmojisAndStickers',
    2147483648n: 'UseApplicationCommands',
    4294967296n: 'RequestToSpeak',
    8589934592n: 'ManageEvents',
    17179869184n: 'ManageThreads',
    34359738368n: 'CreatePublicThreads',
    68719476736n: 'CreatePrivateThreads',
    137438953472n: 'UseExternalStickers',
    274877906944n: 'SendMessagesInThreads',
    549755813888n: 'UseEmbeddedActivities',
    1099511627776n: 'ModerateMembers'
  };

  function bitfieldToNames(bitfield) {
    const bits = BigInt(bitfield);
    const names = [];
    for (const [bitStr, name] of Object.entries(PERMISSION_FLAGS)) {
      const bit = BigInt(bitStr);
      if ((bits & bit) === bit) {
        names.push(name);
      }
    }
    return names;
  }

  // Core execution logic once token is captured
  async function runExporter(token, guildId) {
    console.log(`Starting export for Server ID: ${guildId}`);
    
    const headers = {
      'Authorization': token,
      'Content-Type': 'application/json'
    };

    try {
      console.log('Fetching server roles...');
      const rolesRes = await fetch(`https://discord.com/api/v9/guilds/${guildId}/roles`, { headers });
      if (!rolesRes.ok) throw new Error(`Roles request returned status ${rolesRes.status}`);
      const rawRoles = await rolesRes.json();

      console.log('Fetching server channels...');
      const chanRes = await fetch(`https://discord.com/api/v9/guilds/${guildId}/channels`, { headers });
      if (!chanRes.ok) throw new Error(`Channels request returned status ${chanRes.status}`);
      const rawChannels = await chanRes.json();

      // Map Roles
      const roles = [];
      const tempRoleMap = new Map();
      for (const role of rawRoles) {
        if (role.name === '@everyone') {
          tempRoleMap.set(role.id, '@everyone');
          continue;
        }
        roles.push({
          name: role.name,
          color: `#${role.color.toString(16).padStart(6, '0')}`,
          hoist: role.hoist,
          mentionable: role.mentionable,
          permissions: bitfieldToNames(role.permissions)
        });
        tempRoleMap.set(role.id, role.name);
      }

      // Map channels
      const categories = [];
      const uncategorizedChannels = [];

      const sgCategories = rawChannels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
      const sgOthers = rawChannels.filter(c => c.type !== 4).sort((a, b) => a.position - b.position);

      const typeMapStr = {
        0: 'text',
        2: 'voice',
        5: 'announcement',
        13: 'stage',
        15: 'forum'
      };

      const parseOverwrites = (owList) => {
        return (owList || []).map(ow => {
          if (ow.type !== 0) return null; // Only role overwrites
          const targetName = tempRoleMap.get(ow.id) || '@everyone';
          const allowArr = bitfieldToNames(ow.allow);
          const denyArr = bitfieldToNames(ow.deny);
          return {
            targetName,
            allow: allowArr,
            deny: denyArr
          };
        }).filter(Boolean);
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
        name: 'Exported Guild Layout',
        roles,
        categories,
        uncategorizedChannels,
        emojis: []
      };

      // Download file
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(blueprint, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", "blueprint.json");
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      console.log('🎉 SUCCESS: blueprint.json downloaded successfully!');
    } catch (err) {
      console.error('❌ Export failed:', err.message);
    }
  }

  // Interceptor setup for requests
  const setupInterceptor = () => {
    // 1. Intercept XMLHttpRequest (covers standard client requests)
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
      if (header.toLowerCase() === 'authorization' && value && !value.startsWith('Bot ') && !window.CAPTURED_DISCORD_TOKEN) {
        window.CAPTURED_DISCORD_TOKEN = value;
        console.log('🔑 Token captured from request header!');
        
        const pathParts = window.location.pathname.split('/');
        const guildId = pathParts[2];
        
        if (guildId && guildId !== '@me') {
          runExporter(value, guildId);
        } else {
          console.warn('⚠️ Server ID not detected. Make sure you click into the server you want to clone.');
        }
      }
      return originalSetRequestHeader.apply(this, arguments);
    };

    // 2. Intercept window.fetch (covers fetch calls)
    const originalFetch = window.fetch;
    window.fetch = async function(resource, init) {
      if (init && init.headers) {
        let authHeader;
        if (init.headers instanceof Headers) {
          authHeader = init.headers.get('authorization');
        } else if (typeof init.headers === 'object') {
          authHeader = init.headers['authorization'] || init.headers['Authorization'];
        }

        if (authHeader && !authHeader.startsWith('Bot ') && !window.CAPTURED_DISCORD_TOKEN) {
          window.CAPTURED_DISCORD_TOKEN = authHeader;
          console.log('🔑 Token captured from fetch init!');
          
          const pathParts = window.location.pathname.split('/');
          const guildId = pathParts[2];
          
          if (guildId && guildId !== '@me') {
            runExporter(authHeader, guildId);
          } else {
            console.warn('⚠️ Server ID not detected. Make sure you click into the server you want to clone.');
          }
        }
      }
      return originalFetch.apply(this, arguments);
    };
  };

  // If token is already present (e.g. previously captured in window scope)
  if (window.CAPTURED_DISCORD_TOKEN) {
    const pathParts = window.location.pathname.split('/');
    const guildId = pathParts[2];
    if (guildId && guildId !== '@me') {
      runExporter(window.CAPTURED_DISCORD_TOKEN, guildId);
    } else {
      console.warn('⚠️ Server ID not detected. Click into the server you want to clone.');
    }
  } else {
    setupInterceptor();
    console.log('🕵️ Interceptor activated! Please click on any channel in the server sidebar to capture your session...');
  }
})();
