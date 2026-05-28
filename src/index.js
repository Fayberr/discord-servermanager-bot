import { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  PermissionFlagsBits
} from 'discord.js';
import dotenv from 'dotenv';
import { 
  saveTemplate, 
  getTemplate, 
  listTemplates, 
  deleteTemplate,
  importTemplateFromCode
} from './services/templateService.js';
import { generateBlueprint, editBlueprint } from './services/aiService.js';
import { serializeGuild } from './utils/serialize.js';
import { computeDiff } from './utils/diffEngine.js';
import { applyDiff } from './utils/applyEngine.js';
import { logMessage } from './utils/logger.js';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildEmojisAndStickers
  ]
});

// Session cache to store pending changes for button confirmations
const pendingSessions = new Map();

// Helper to format diff summary into markdown
function formatDiffSummary(diff) {
  let summary = '';
  
  if (diff.roles.toCreate.length || diff.roles.toUpdate.length || diff.roles.toDelete.length) {
    summary += '### 👥 Roles\n';
    if (diff.roles.toCreate.length) summary += `*   🟩 **Create**: ${diff.roles.toCreate.map(r => `\`${r.name}\``).join(', ')}\n`;
    if (diff.roles.toUpdate.length) summary += `*   🟨 **Update**: ${diff.roles.toUpdate.map(r => `\`${r.name}\``).join(', ')}\n`;
    if (diff.roles.toDelete.length) summary += `*   🟥 **Delete**: ${diff.roles.toDelete.map(r => `\`${r.name}\``).join(', ')}\n`;
    summary += '\n';
  }
  
  if (diff.categories.toCreate.length || diff.categories.toUpdate.length || diff.categories.toDelete.length) {
    summary += '### 📁 Categories\n';
    if (diff.categories.toCreate.length) summary += `*   🟩 **Create**: ${diff.categories.toCreate.map(c => `\`${c.name}\``).join(', ')}\n`;
    if (diff.categories.toUpdate.length) summary += `*   🟨 **Update**: ${diff.categories.toUpdate.map(c => `\`${c.name}\``).join(', ')}\n`;
    if (diff.categories.toDelete.length) summary += `*   🟥 **Delete**: ${diff.categories.toDelete.map(c => `\`${c.name}\``).join(', ')}\n`;
    summary += '\n';
  }

  if (diff.channels.toCreate.length || diff.channels.toUpdate.length || diff.channels.toDelete.length) {
    summary += '### 💬 Channels\n';
    if (diff.channels.toCreate.length) summary += `*   🟩 **Create**: ${diff.channels.toCreate.map(c => `\`#${c.name}\` (${c.type})`).join(', ')}\n`;
    if (diff.channels.toUpdate.length) summary += `*   🟨 **Update**: ${diff.channels.toUpdate.map(c => `\`#${c.name}\` (${c.type})`).join(', ')}\n`;
    if (diff.channels.toDelete.length) summary += `*   🟥 **Delete**: ${diff.channels.toDelete.map(c => `\`#${c.name}\` (${c.type})`).join(', ')}\n`;
  }
  
  return summary || 'No modifications detected.';
}

client.once('ready', () => {
  logMessage(client, `Logged in as ${client.user.tag} and ready!`, 'success');
});

client.on('interactionCreate', async (interaction) => {
  // 1. Handle Autocomplete Suggestions
  if (interaction.isAutocomplete()) {
    const { commandName } = interaction;
    if (commandName === 'load' || commandName === 'delete') {
      try {
        const focusedValue = interaction.options.getFocused();
        const templates = await listTemplates();
        const filtered = templates.filter(choice => 
          choice.toLowerCase().includes(focusedValue.toLowerCase())
        );
        await interaction.respond(
          filtered.map(choice => ({ name: choice, value: choice })).slice(0, 25)
        );
      } catch (err) {
        console.error('Autocomplete Error:', err);
      }
    }
    return;
  }

  // 2. Handle Commands
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;


    // Check if the user is authorized
    const authorizedUser = process.env.AUTHORIZED_USER_ID;
    if (authorizedUser && interaction.user.id !== authorizedUser) {
      return interaction.reply({ 
        content: '❌ You are not authorized to use this bot.', 
        ephemeral: true 
      });
    }

    // Check administrator/guild permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ 
        content: '❌ You need Administrator permissions in this server to run management commands.', 
        ephemeral: true 
      });
    }

    try {
      if (commandName === 'save') {
        const name = interaction.options.getString('name');
        await interaction.deferReply();
        
        await saveTemplate(interaction.guild, name);
        await logMessage(client, `Saved template "${name}" from server "${interaction.guild.name}" triggered by ${interaction.user.tag}.`, 'success');
        return interaction.editReply(`✅ Successfully saved current server configuration as template: **${name}** (including roles, categories, channels, permissions, and emojis).`);
      }

      if (commandName === 'list') {
        const templates = await listTemplates();
        if (templates.length === 0) {
          return interaction.reply('📁 No templates saved yet.');
        }
        return interaction.reply(`📁 **Saved Templates:**\n${templates.map(t => `- \`${t}\``).join('\n')}`);
      }

      if (commandName === 'delete') {
        const name = interaction.options.getString('name');
        const deleted = await deleteTemplate(name);
        if (deleted) {
          await logMessage(client, `Deleted template "${name}" triggered by ${interaction.user.tag}.`, 'success');
          return interaction.reply(`✅ Successfully deleted template: **${name}**`);
        } else {
          return interaction.reply(`❌ Template not found: **${name}**`);
        }
      }

      if (commandName === 'wipe') {
        await interaction.deferReply();

        const current = await serializeGuild(interaction.guild);

        // Diff schema for wiping everything
        const diff = {
          roles: {
            toCreate: [],
            toUpdate: [],
            toDelete: current.roles
          },
          categories: {
            toCreate: [],
            toUpdate: [],
            toDelete: current.categories
          },
          channels: {
            toCreate: [],
            toUpdate: [],
            toDelete: []
          },
          emojis: {
            toCreate: [],
            toUpdate: [],
            toDelete: current.emojis
          }
        };

        // Flatten all channels and filter out the current command channel
        const flattenChannels = (blueprint) => {
          const list = [];
          for (const cat of blueprint.categories) {
            for (const chan of cat.channels) {
              list.push({ ...chan, categoryName: cat.name });
            }
          }
          for (const chan of blueprint.uncategorizedChannels) {
            list.push({ ...chan, categoryName: null });
          }
          return list;
        };

        const allChans = flattenChannels(current);
        diff.channels.toDelete = allChans.filter(c => c.id !== interaction.channelId);

        pendingSessions.set(interaction.user.id, {
          type: 'wipe',
          diff,
          guildId: interaction.guild.id
        });

        const summary = `**This will delete:**\n` +
          `*   🔴 **Roles**: ${diff.roles.toDelete.length} custom roles\n` +
          `*   🔴 **Categories**: ${diff.categories.toDelete.length} categories\n` +
          `*   🔴 **Channels**: ${diff.channels.toDelete.length} channels (excluding this one)\n` +
          `*   🔴 **Emojis**: ${diff.emojis.toDelete.length} custom emojis`;

        const embed = new EmbedBuilder()
          .setTitle('🚨 Confirm Server Wipe')
          .setDescription(`Are you sure you want to completely wipe **${interaction.guild.name}** to a clean slate?\n*This action is irreversible!*\n\n${summary}`)
          .setColor('#d9534f')
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_apply:${interaction.user.id}`)
            .setLabel('Yes, Wipe Server')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`cancel_apply:${interaction.user.id}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      if (commandName === 'import') {
        let code = interaction.options.getString('code');
        const name = interaction.options.getString('name');
        
        await interaction.deferReply();

        // Extract code if user pasted a link
        if (code.includes('discord.new/')) {
          code = code.split('discord.new/')[1].split('/')[0].trim();
        } else if (code.includes('/templates/')) {
          code = code.split('/templates/')[1].split('/')[0].trim();
        }

        try {
          await importTemplateFromCode(code, name);
          await logMessage(client, `Imported template "${name}" from code "${code}" triggered by ${interaction.user.tag}.`, 'success');
          return interaction.editReply(`✅ Successfully imported Discord Server Template: **${name}** (from code: \`${code}\`).\n\nYou can now apply this layout to any server using: \`/load name:${name}\``);
        } catch (err) {
          await logMessage(client, `Failed to import template from code "${code}": ${err.message}`, 'error');
          return interaction.editReply(`❌ Failed to import template. Please verify that the template code or link is valid and try again.\n*(Error details: ${err.message})*`);
        }
      }

      if (commandName === 'clone') {
        const sourceId = interaction.options.getString('source_id');
        const destructive = interaction.options.getBoolean('destructive') ?? true;
        
        await interaction.deferReply();

        let sourceGuild;
        try {
          sourceGuild = await client.guilds.fetch(sourceId);
        } catch (err) {
          await logMessage(client, `Clone failed: Bot does not have access to source guild ID "${sourceId}" triggered by ${interaction.user.tag}.`, 'error');
          return interaction.editReply(`❌ Clone failed. The bot does not have access to server ID: \`${sourceId}\` (or the ID is invalid). Ensure the bot is added to both servers!`);
        }

        const blueprint = await serializeGuild(sourceGuild);
        
        const current = await serializeGuild(interaction.guild);
        const diff = computeDiff(current, blueprint, { 
          destructive, 
          commandChannelId: interaction.channelId 
        });

        const summary = formatDiffSummary(diff);
        pendingSessions.set(interaction.user.id, {
          type: 'clone',
          sourceGuildId: sourceId,
          diff,
          guildId: interaction.guild.id
        });

        const embed = new EmbedBuilder()
          .setTitle(`Confirm Server Clone`)
          .setDescription(`Are you sure you want to clone the layout of server **${sourceGuild.name}** onto this server?\n*Destructive overwrite: **${destructive}***\n\n${summary}`)
          .setColor('#9b59b6')
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_apply:${interaction.user.id}`)
            .setLabel('Confirm & Clone')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`cancel_apply:${interaction.user.id}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      if (commandName === 'load') {
        const name = interaction.options.getString('name');
        const destructive = interaction.options.getBoolean('destructive') ?? true;
        
        await interaction.deferReply();
        const blueprint = await getTemplate(name);
        
        if (!blueprint) {
          return interaction.editReply(`❌ Template **${name}** does not exist.`);
        }

        const current = await serializeGuild(interaction.guild);
        const diff = computeDiff(current, blueprint, { 
          destructive, 
          commandChannelId: interaction.channelId 
        });

        const summary = formatDiffSummary(diff);
        pendingSessions.set(interaction.user.id, {
          type: 'load',
          templateName: name,
          diff,
          guildId: interaction.guild.id
        });

        const embed = new EmbedBuilder()
          .setTitle(`Confirm Load Template: ${name}`)
          .setDescription(`Are you sure you want to load this template?\n*Destructive overwrite: **${destructive}***\n\n${summary}`)
          .setColor('#ff4500')
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_apply:${interaction.user.id}`)
            .setLabel('Confirm & Apply')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`cancel_apply:${interaction.user.id}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      if (commandName === 'create') {
        const prompt = interaction.options.getString('prompt');
        await interaction.deferReply();

        // 1. Generate new target blueprint
        const blueprint = await generateBlueprint(prompt);
        
        // 2. Compute diff in destructive mode (create implies new layout)
        const current = await serializeGuild(interaction.guild);
        const diff = computeDiff(current, blueprint, { 
          destructive: true, 
          commandChannelId: interaction.channelId 
        });

        const summary = formatDiffSummary(diff);
        pendingSessions.set(interaction.user.id, {
          type: 'ai-create',
          diff,
          guildId: interaction.guild.id
        });

        const embed = new EmbedBuilder()
          .setTitle('Confirm AI Server Creation')
          .setDescription(`AI generated a new blueprint based on your prompt:\n*"${prompt}"*\n\n**Proposed Changes (Destructive Overwrite):**\n\n${summary}`)
          .setColor('#7289da')
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_apply:${interaction.user.id}`)
            .setLabel('Approve & Build')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`cancel_apply:${interaction.user.id}`)
            .setLabel('Discard')
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      if (commandName === 'edit') {
        const prompt = interaction.options.getString('prompt');
        await interaction.deferReply();

        const current = await serializeGuild(interaction.guild);
        
        // 1. Ask AI to edit the current blueprint
        const blueprint = await editBlueprint(current, prompt);
        
        // 2. Compute incremental diff
        const diff = computeDiff(current, blueprint, { 
          destructive: false, 
          commandChannelId: interaction.channelId 
        });

        const summary = formatDiffSummary(diff);
        pendingSessions.set(interaction.user.id, {
          type: 'ai-edit',
          diff,
          guildId: interaction.guild.id
        });

        const embed = new EmbedBuilder()
          .setTitle('Confirm AI Server Edit')
          .setDescription(`AI proposed edits based on your prompt:\n*"${prompt}"*\n\n**Proposed Incremental Changes:**\n\n${summary}`)
          .setColor('#e67e22')
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_apply:${interaction.user.id}`)
            .setLabel('Approve & Edit')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`cancel_apply:${interaction.user.id}`)
            .setLabel('Discard')
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

    } catch (err) {
      logMessage(client, `Error running command /${commandName} triggered by ${interaction.user.tag}: ${err.message}`, 'error');
      const replyFn = interaction.deferred ? 'editReply' : 'reply';
      return interaction[replyFn]({ 
        content: `❌ An error occurred: ${err.message}`, 
        ephemeral: true 
      });
    }
  }

  // 2. Handle Button Clicks (Confirmations)
  if (interaction.isButton()) {
    const [action, userId] = interaction.customId.split(':');
    
    if (interaction.user.id !== userId) {
      return interaction.reply({ 
        content: '❌ Only the user who ran the command can confirm these changes.', 
        ephemeral: true 
      });
    }

    const session = pendingSessions.get(userId);
    if (!session || session.guildId !== interaction.guild.id) {
      return interaction.update({ 
        content: '❌ Expired or invalid session.', 
        embeds: [], 
        components: [] 
      });
    }

    // Clear session
    pendingSessions.delete(userId);

    if (action === 'cancel_apply') {
      return interaction.update({ 
        content: '⚠️ Operation discarded. No changes were made.', 
        embeds: [], 
        components: [] 
      });
    }

    if (action === 'confirm_apply') {
      try {
        await logMessage(client, `Applying server modification diff (${session.type}) to "${interaction.guild.name}" triggered by ${interaction.user.tag}.`, 'info');
        
        await interaction.update({ 
          content: '🚧 **Applying changes...** This may take a few seconds.', 
          embeds: [], 
          components: [] 
        });

        // Apply Diff
        let sourceGuild = null;
        if (session.type === 'clone' && session.sourceGuildId) {
          try {
            sourceGuild = await client.guilds.fetch(session.sourceGuildId);
          } catch {}
        }

        await applyDiff(interaction.guild, session.diff, {
          templateName: session.type === 'load' ? session.templateName : null,
          sourceGuild
        });

        await logMessage(client, `Successfully applied changes to server "${interaction.guild.name}".`, 'success');

        // Notify in command channel (if still exists) or fallback
        const finishMessage = '✅ **Server updates successfully applied!**';
        try {
          const ch = await interaction.guild.channels.fetch(interaction.channelId);
          if (ch) {
            await ch.send(finishMessage);
          }
        } catch {
          // If channel was deleted, we fallback.
          try {
            await interaction.user.send(finishMessage);
          } catch {}
        }
      } catch (err) {
        logMessage(client, `Failed to apply server changes to "${interaction.guild.name}": ${err.message}`, 'error');
        try {
          await interaction.channel.send(`❌ Failed to apply changes: ${err.message}`);
        } catch {}
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
