import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const schema = {
  type: "object",
  properties: {
    roles: {
      type: "array",
      description: "List of roles to create. Order by priority, highest permissions first.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Role name" },
          color: { type: "string", description: "Hex color code, e.g., '#00ff00', '#ff0000', or leave empty for default color" },
          hoist: { type: "boolean", description: "Show role members separately from online members" },
          mentionable: { type: "boolean", description: "Allow anyone to mention this role" },
          permissions: {
            type: "array",
            description: "Discord permission flag names, e.g., 'ViewChannel', 'SendMessages', 'Connect', 'Speak', 'ManageChannels', 'ManageRoles', 'Administrator', 'ReadMessageHistory'. Make sure capitalization matches Discord specifications.",
            items: { type: "string" }
          }
        },
        required: ["name", "color", "hoist", "mentionable", "permissions"]
      }
    },
    categories: {
      type: "array",
      description: "List of categories with their nested channels",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Category name" },
          permissionOverwrites: {
            type: "array",
            items: {
              type: "object",
              properties: {
                targetName: { type: "string", description: "Name of the target role, or '@everyone'" },
                allow: { type: "array", items: { type: "string", description: "Discord permission flag names allowed" } },
                deny: { type: "array", items: { type: "string", description: "Discord permission flag names denied" } }
              },
              required: ["targetName", "allow", "deny"]
            }
          },
          channels: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Channel name (lowercase, no spaces, hyphens instead of spaces for text channels)" },
                type: { type: "string", enum: ["text", "voice", "announcement", "forum", "stage"] },
                topic: { type: "string", description: "Description or topic of the channel" },
                nsfw: { type: "boolean" },
                rateLimitPerUser: { type: "integer", description: "Slowmode cooldown in seconds (0 for none)" },
                permissionOverwrites: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      targetName: { type: "string", description: "Name of the target role, or '@everyone'" },
                      allow: { type: "array", items: { type: "string" } },
                      deny: { type: "array", items: { type: "string" } }
                    },
                    required: ["targetName", "allow", "deny"]
                  }
                }
              },
              required: ["name", "type"]
            }
          }
        },
        required: ["name", "channels"]
      }
    },
    uncategorizedChannels: {
      type: "array",
      description: "Channels not attached to any category",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["text", "voice", "announcement", "forum", "stage"] },
          topic: { type: "string" },
          nsfw: { type: "boolean" },
          rateLimitPerUser: { type: "integer" },
          permissionOverwrites: {
            type: "array",
            items: {
              type: "object",
              properties: {
                targetName: { type: "string", description: "Name of the target role, or '@everyone'" },
                allow: { type: "array", items: { type: "string" } },
                deny: { type: "array", items: { type: "string" } }
              },
              required: ["targetName", "allow", "deny"]
            }
          }
        },
        required: ["name", "type"]
      }
    }
  },
  required: ["roles", "categories", "uncategorizedChannels"]
};

const SYSTEM_INSTRUCTION = `You are a professional Discord server architect.
Your job is to design beautiful, functional, and organized Discord servers in JSON format based on the user's description.

Rules for roles:
1. Always create logical hierarchies (e.g. Owner, Admin, Moderator, Member, Guest).
2. Assign sensible colors and permissions.
3. Don't add dangerous permissions like 'Administrator' or 'ManageGuild' to normal member roles.

Rules for channels and categories:
1. Use appropriate channel types ('text', 'voice', 'announcement', 'forum', 'stage').
2. Keep channel names for text channels clean (use lowercase, alphanumeric characters, and hyphens instead of spaces, e.g., 'rules', 'general-chat', 'voice-lounge-1').
3. For voice channels, use proper capitalized casing (e.g., 'Lobby', 'General Voice').
4. Add engaging topic descriptions for text channels to guide users.
5. Set up proper permission overwrites. For example, if there is a 'Staff' role, create a locked 'staff-announcements' channel where '@everyone' has 'ViewChannel' denied, and 'Staff' has 'ViewChannel' and 'SendMessages' allowed.
6. Make sure permissions in allow/deny lists use exact Discord naming strings:
   - ViewChannel
   - SendMessages
   - EmbedLinks
   - AttachFiles
   - ReadMessageHistory
   - MentionEveryone
   - UseExternalEmojis
   - AddReactions
   - Connect
   - Speak
   - MuteMembers
   - DeafenMembers
   - MoveMembers
   - UseVAD (Voice Activity Detection)
   - PrioritySpeaker
   - Stream
   - ManageChannels
   - ManageRoles
   - ManageMessages
   - ManageWebhooks
   - CreateInstantInvite
   - SendTTSMessages
   - UseApplicationCommands
   - ManageThreads
   - CreatePublicThreads
   - CreatePrivateThreads
   - SendMessagesInThreads
   - UseEmbeddedActivities

Verify that all targetName fields in permissionOverwrites refer exactly to role names defined in the 'roles' array, or is '@everyone'.

You must return ONLY the raw JSON output matching the requested schema.`;

/**
 * Generate a new server blueprint using Gemini.
 * @param {string} promptUser 
 * @returns {Promise<Object>} The server blueprint JSON.
 */
export async function generateBlueprint(promptUser) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  });

  const response = await model.generateContent(`Generate a complete Discord server blueprint based on this request:
"${promptUser}"`);

  const text = response.response.text();
  return JSON.parse(text);
}

const deltaSchema = {
  type: "object",
  properties: {
    roles: {
      type: "array",
      description: "List of role changes (create, update, or delete).",
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update", "delete"] },
          name: { type: "string", description: "Role name" },
          oldName: { type: "string", description: "Old name if renaming a role, otherwise omit" },
          color: { type: "string", description: "Hex color code e.g. '#00ff00'" },
          hoist: { type: "boolean" },
          mentionable: { type: "boolean" },
          permissions: { type: "array", items: { type: "string" } }
        },
        required: ["action", "name"]
      }
    },
    categories: {
      type: "array",
      description: "List of category changes.",
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update", "delete"] },
          name: { type: "string" },
          oldName: { type: "string", description: "Old category name if renaming, otherwise omit" },
          permissionOverwrites: {
            type: "array",
            items: {
              type: "object",
              properties: {
                targetName: { type: "string" },
                allow: { type: "array", items: { type: "string" } },
                deny: { type: "array", items: { type: "string" } }
              },
              required: ["targetName", "allow", "deny"]
            }
          }
        },
        required: ["action", "name"]
      }
    },
    channels: {
      type: "array",
      description: "List of channel changes.",
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update", "delete"] },
          name: { type: "string" },
          oldName: { type: "string", description: "Old channel name if renaming, otherwise omit" },
          type: { type: "string", enum: ["text", "voice", "announcement", "forum", "stage"] },
          topic: { type: "string" },
          nsfw: { type: "boolean" },
          rateLimitPerUser: { type: "integer" },
          categoryName: { type: "string", description: "Name of the parent category" },
          permissionOverwrites: {
            type: "array",
            items: {
              type: "object",
              properties: {
                targetName: { type: "string" },
                allow: { type: "array", items: { type: "string" } },
                deny: { type: "array", items: { type: "string" } }
              },
              required: ["targetName", "allow", "deny"]
            }
          }
        },
        required: ["action", "name"]
      }
    }
  },
  required: ["roles", "categories", "channels"]
};

// Helper: Applies the AI's diff instructions to the current server layout
function mergeDelta(current, delta) {
  const updated = JSON.parse(JSON.stringify(current));

  // 1. Roles
  for (const roleDelta of delta.roles || []) {
    const idx = updated.roles.findIndex(r => r.name.toLowerCase() === (roleDelta.oldName || roleDelta.name).toLowerCase());
    if (roleDelta.action === 'delete') {
      if (idx !== -1) updated.roles.splice(idx, 1);
    } else if (roleDelta.action === 'update') {
      if (idx !== -1) {
        updated.roles[idx] = {
          ...updated.roles[idx],
          name: roleDelta.name,
          color: roleDelta.color !== undefined ? roleDelta.color : updated.roles[idx].color,
          hoist: roleDelta.hoist !== undefined ? roleDelta.hoist : updated.roles[idx].hoist,
          mentionable: roleDelta.mentionable !== undefined ? roleDelta.mentionable : updated.roles[idx].mentionable,
          permissions: roleDelta.permissions !== undefined ? roleDelta.permissions : updated.roles[idx].permissions
        };
      }
    } else if (roleDelta.action === 'create') {
      if (idx === -1) {
        updated.roles.push({
          name: roleDelta.name,
          color: roleDelta.color || '#000000',
          hoist: roleDelta.hoist || false,
          mentionable: roleDelta.mentionable || false,
          permissions: roleDelta.permissions || []
        });
      }
    }
  }

  // 2. Categories
  for (const catDelta of delta.categories || []) {
    const idx = updated.categories.findIndex(c => c.name.toLowerCase() === (catDelta.oldName || catDelta.name).toLowerCase());
    if (catDelta.action === 'delete') {
      if (idx !== -1) updated.categories.splice(idx, 1);
    } else if (catDelta.action === 'update') {
      if (idx !== -1) {
        updated.categories[idx].name = catDelta.name;
        if (catDelta.permissionOverwrites) updated.categories[idx].permissionOverwrites = catDelta.permissionOverwrites;
      }
    } else if (catDelta.action === 'create') {
      if (idx === -1) {
        updated.categories.push({
          name: catDelta.name,
          permissionOverwrites: catDelta.permissionOverwrites || [],
          channels: []
        });
      }
    }
  }

  // Helper to remove channel from current tree
  const pullChannel = (name, type) => {
    // Search categories
    for (const cat of updated.categories) {
      const idx = cat.channels.findIndex(c => c.name.toLowerCase() === name.toLowerCase() && c.type === type);
      if (idx !== -1) return cat.channels.splice(idx, 1)[0];
    }
    // Search uncategorized
    const idx = updated.uncategorizedChannels.findIndex(c => c.name.toLowerCase() === name.toLowerCase() && c.type === type);
    if (idx !== -1) return updated.uncategorizedChannels.splice(idx, 1)[0];
    return null;
  };

  // 3. Channels
  for (const chanDelta of delta.channels || []) {
    const name = chanDelta.name;
    const searchName = chanDelta.oldName || name;
    const type = chanDelta.type || 'text';

    if (chanDelta.action === 'delete') {
      pullChannel(searchName, type);
    } else {
      const existing = pullChannel(searchName, type);
      const targetChan = {
        name: name,
        type: type,
        topic: chanDelta.topic !== undefined ? chanDelta.topic : (existing ? existing.topic : null),
        nsfw: chanDelta.nsfw !== undefined ? chanDelta.nsfw : (existing ? existing.nsfw : false),
        rateLimitPerUser: chanDelta.rateLimitPerUser !== undefined ? chanDelta.rateLimitPerUser : (existing ? existing.rateLimitPerUser : 0),
        permissionOverwrites: chanDelta.permissionOverwrites !== undefined ? chanDelta.permissionOverwrites : (existing ? existing.permissionOverwrites : [])
      };

      if (chanDelta.categoryName) {
        const cat = updated.categories.find(c => c.name.toLowerCase() === chanDelta.categoryName.toLowerCase());
        if (cat) {
          cat.channels.push(targetChan);
        } else {
          updated.uncategorizedChannels.push(targetChan);
        }
      } else {
        updated.uncategorizedChannels.push(targetChan);
      }
    }
  }

  return updated;
}

/**
 * Edit an existing server blueprint using Gemini (returns merged blueprint).
 * @param {Object} currentBlueprint The current server blueprint JSON.
 * @param {string} editRequest The edit description from the user.
 * @returns {Promise<Object>} The updated server blueprint JSON.
 */
export async function editBlueprint(currentBlueprint, editRequest) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `You are a Discord server architect editing a layout.
Instead of rewriting the entire server layout, your job is to output ONLY the changes (additions, modifications, or deletions) to apply.
Output a JSON matching the delta schema. Make sure all permission strings are exact Discord strings.`,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: deltaSchema
    }
  });

  // Strip large elements from input prompt (like raw emoji URLs) to keep context compact
  const compactBlueprint = {
    roles: currentBlueprint.roles.map(r => ({ name: r.name, color: r.color, permissions: r.permissions })),
    categories: currentBlueprint.categories.map(c => ({ name: c.name, channels: c.channels.map(ch => ({ name: ch.name, type: ch.type })) })),
    uncategorizedChannels: currentBlueprint.uncategorizedChannels.map(ch => ({ name: ch.name, type: ch.type }))
  };

  const prompt = `Current server structure:
\`\`\`json
${JSON.stringify(compactBlueprint, null, 2)}
\`\`\`

User edit request:
"${editRequest}"

Determine the necessary edits (create, update, or delete roles, categories, and channels) and return the delta JSON structure.`;

  const response = await model.generateContent(prompt);
  const text = response.response.text();
  const delta = JSON.parse(text);

  console.log('AI Edit Delta:', JSON.stringify(delta, null, 2));

  // Merge changes into current blueprint and return the combined result
  return mergeDelta(currentBlueprint, delta);
}
