function arraysEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const setA = new Set(a.map(x => x.toLowerCase()));
  return b.every(val => setA.has(val.toLowerCase()));
}

function parseHexColor(colorStr) {
  if (!colorStr) return 0;
  return colorStr.replace('#', '');
}

/**
 * Computes a diff between current guild state and a target blueprint.
 * @param {Object} current Current serialized blueprint.
 * @param {Object} target Target blueprint.
 * @param {Object} options Options object.
 * @param {boolean} options.destructive If true, wipes non-matching items.
 * @param {string} options.commandChannelId The ID of the channel where command was executed (do not delete).
 * @returns {Object} Action lists for roles, categories, and channels.
 */
export function computeDiff(current, target, options = {}) {
  const { destructive = false, commandChannelId = null } = options;

  const roles = { toCreate: [], toUpdate: [], toDelete: [] };
  const categories = { toCreate: [], toUpdate: [], toDelete: [] };
  const channels = { toCreate: [], toUpdate: [], toDelete: [] };

  // ====================
  // 1. ROLES DIFF
  // ====================
  const currentRolesMap = new Map(current.roles.map(r => [r.name.toLowerCase(), r]));
  const targetRolesMap = new Map(target.roles.map(r => [r.name.toLowerCase(), r]));

  if (destructive) {
    // Delete all current roles that aren't in target (excluding @everyone and managed)
    for (const curRole of current.roles) {
      if (!targetRolesMap.has(curRole.name.toLowerCase())) {
        roles.toDelete.push(curRole);
      }
    }
    // Create all target roles
    for (const tarRole of target.roles) {
      roles.toCreate.push(tarRole);
    }
  } else {
    // Create or Update based on existence
    for (const tarRole of target.roles) {
      const curRole = currentRolesMap.get(tarRole.name.toLowerCase());
      if (curRole) {
        // Compare values
        const curColorHex = curRole.color.replace('#', '').toLowerCase();
        const tarColorHex = tarRole.color.replace('#', '').toLowerCase();
        const colorDiff = curColorHex !== tarColorHex && (tarColorHex !== '000000' || curColorHex !== '0');
        
        const isDifferent = 
          colorDiff ||
          curRole.hoist !== tarRole.hoist ||
          curRole.mentionable !== tarRole.mentionable ||
          !arraysEqual(curRole.permissions, tarRole.permissions);

        if (isDifferent) {
          roles.toUpdate.push({
            id: curRole.id,
            name: tarRole.name,
            color: tarRole.color,
            hoist: tarRole.hoist,
            mentionable: tarRole.mentionable,
            permissions: tarRole.permissions
          });
        }
      } else {
        roles.toCreate.push(tarRole);
      }
    }

    // Delete current roles that aren't in target
    for (const curRole of current.roles) {
      if (!targetRolesMap.has(curRole.name.toLowerCase())) {
        roles.toDelete.push(curRole);
      }
    }
  }

  // ====================
  // 2. CATEGORIES DIFF
  // ====================
  const currentCategoriesMap = new Map(current.categories.map(c => [c.name.toLowerCase(), c]));
  const targetCategoriesMap = new Map(target.categories.map(c => [c.name.toLowerCase(), c]));

  if (destructive) {
    for (const curCat of current.categories) {
      categories.toDelete.push(curCat);
    }
    for (const tarCat of target.categories) {
      categories.toCreate.push(tarCat);
    }
  } else {
    for (const tarCat of target.categories) {
      const curCat = currentCategoriesMap.get(tarCat.name.toLowerCase());
      if (curCat) {
        // Categories don't have many properties, but they have permissions
        // We will update permissions in the apply step. For diffing we can just note it
        categories.toUpdate.push({
          id: curCat.id,
          name: tarCat.name,
          permissionOverwrites: tarCat.permissionOverwrites || []
        });
      } else {
        categories.toCreate.push(tarCat);
      }
    }

    for (const curCat of current.categories) {
      if (!targetCategoriesMap.has(curCat.name.toLowerCase())) {
        categories.toDelete.push(curCat);
      }
    }
  }

  // ====================
  // 3. CHANNELS DIFF
  // ====================
  // Helper to flatten channels with parent category name
  const flattenChannels = (blueprint) => {
    const list = [];
    // From categories
    for (const cat of blueprint.categories) {
      for (const chan of cat.channels) {
        list.push({
          ...chan,
          categoryName: cat.name
        });
      }
    }
    // Uncategorized
    for (const chan of blueprint.uncategorizedChannels) {
      list.push({
        ...chan,
        categoryName: null
      });
    }
    return list;
  };

  const currentChans = flattenChannels(current);
  const targetChans = flattenChannels(target);

  // Match current channels by Name + Type + CategoryName
  const getChanKey = (c) => `${c.categoryName ? c.categoryName.toLowerCase() + '/' : ''}${c.name.toLowerCase()}:${c.type}`;

  const currentChansMap = new Map(currentChans.map(c => [getChanKey(c), c]));
  const targetChansMap = new Map(targetChans.map(c => [getChanKey(c), c]));

  if (destructive) {
    for (const curChan of currentChans) {
      channels.toDelete.push(curChan);
    }
    for (const tarChan of targetChans) {
      channels.toCreate.push(tarChan);
    }
  } else {
    for (const tarChan of targetChans) {
      const curChan = currentChansMap.get(getChanKey(tarChan));
      if (curChan) {
        const isDifferent =
          curChan.topic !== tarChan.topic ||
          curChan.nsfw !== tarChan.nsfw ||
          curChan.rateLimitPerUser !== tarChan.rateLimitPerUser ||
          curChan.categoryName !== tarChan.categoryName; // parent changed

        // Note: permission overwrites updates are handled in apply step, but we flag for update
        if (isDifferent || tarChan.permissionOverwrites) {
          channels.toUpdate.push({
            id: curChan.id,
            name: tarChan.name,
            type: tarChan.type,
            topic: tarChan.topic || null,
            nsfw: tarChan.nsfw || false,
            rateLimitPerUser: tarChan.rateLimitPerUser || 0,
            categoryName: tarChan.categoryName,
            permissionOverwrites: tarChan.permissionOverwrites || []
          });
        }
      } else {
        channels.toCreate.push(tarChan);
      }
    }

    for (const curChan of currentChans) {
      if (!targetChansMap.has(getChanKey(curChan))) {
        channels.toDelete.push(curChan);
      }
    }
  }

  // ====================
  // 4. COMMAND CHANNEL PROTECTION & REUSE
  // ====================
  if (commandChannelId) {
    const isCommandChannelInDelete = channels.toDelete.find(c => c.id === commandChannelId);
    
    if (isCommandChannelInDelete) {
      // Find a text channel we are going to create and reuse the command channel for it instead
      const textChanToCreateIdx = channels.toCreate.findIndex(c => c.type === 'text');
      
      if (textChanToCreateIdx !== -1) {
        const textChanToCreate = channels.toCreate[textChanToCreateIdx];
        
        // Remove from delete and create
        channels.toDelete = channels.toDelete.filter(c => c.id !== commandChannelId);
        channels.toCreate.splice(textChanToCreateIdx, 1);
        
        // Add to update
        channels.toUpdate.push({
          id: commandChannelId,
          name: textChanToCreate.name,
          type: 'text',
          topic: textChanToCreate.topic || null,
          nsfw: textChanToCreate.nsfw || false,
          rateLimitPerUser: textChanToCreate.rateLimitPerUser || 0,
          categoryName: textChanToCreate.categoryName,
          permissionOverwrites: textChanToCreate.permissionOverwrites || []
        });
      } else {
        // No text channel to create, just keep the command channel as-is (uncategorized or parent-less if parent is deleted)
        // Remove from delete list
        channels.toDelete = channels.toDelete.filter(c => c.id !== commandChannelId);
      }
    }
  }

  return { roles, categories, channels };
}
