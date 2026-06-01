const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
  StringSelectMenuBuilder, PermissionFlagsBits,
} = require('discord.js');
const db = require('../database');
const { updateTimesChannel } = require('../utils/times');

const MAX_NON_CAPTAIN_SLOTS = 5;

async function updateLineupPost(guild, team) {
  const channel = guild.channels.cache.get(team.channel_lineup_id) || await guild.channels.fetch(team.channel_lineup_id).catch(() => null);
  if (!channel) return;

  const playersRes = await db.query(
    'SELECT discord_username, is_captain FROM players WHERE team_id = $1 ORDER BY is_captain DESC, id ASC',
    [team.id]
  );
  const players = playersRes.rows;

  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (messages) {
    for (const msg of messages.filter(m => m.author.bot).values()) {
      await msg.delete().catch(() => {});
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x4fc3f7)
    .setTitle(`Lineup: ${team.name}`)
    .setDescription(
      players.length > 0
        ? players.map(p => `${p.is_captain ? '⭐' : '🎮'} ${p.discord_username}${p.is_captain ? ' (Capitão)' : ''}`).join('\n')
        : 'Sem jogadores cadastrados.'
    )
    .setFooter({ text: `${players.length} jogador${players.length === 1 ? '' : 'es'}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lineup:editar:${team.id}`)
      .setLabel('Editar lineup')
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lineup')
    .setDescription('Gerencia a lineup do seu time')
    .addSubcommand(sub =>
      sub.setName('atualizar')
        .setDescription('Atualiza o post da lineup com os dados atuais do banco')
    ),

  updateLineupPost,

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (subcommand === 'atualizar') {
      // Capitão atualiza o próprio time direto
      const captainTeam = await db.query('SELECT * FROM teams WHERE captain_discord_id = $1', [interaction.user.id]);
      if (captainTeam.rows.length > 0) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await updateLineupPost(interaction.guild, captainTeam.rows[0]);
        return interaction.editReply({ content: 'Lineup atualizada.' });
      }

      // Admin escolhe o time
      if (isAdmin) {
        const teams = await db.query('SELECT id, name FROM teams ORDER BY name');
        if (teams.rows.length === 0) {
          return interaction.reply({ content: 'Nenhum time cadastrado.', flags: MessageFlags.Ephemeral });
        }
        const menu = new StringSelectMenuBuilder()
          .setCustomId('lineup:atualizar-select')
          .setPlaceholder('Selecione o time para atualizar')
          .addOptions(teams.rows.slice(0, 25).map(t => ({ label: t.name, value: String(t.id) })));
        return interaction.reply({
          content: 'Qual time deseja atualizar?',
          components: [new ActionRowBuilder().addComponents(menu)],
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({ content: 'Apenas o capitão do time ou um administrador pode atualizar a lineup.', flags: MessageFlags.Ephemeral });
    }
  },

  async handleComponent(interaction) {
    const parts = interaction.customId.split(':');
    const action = parts[1];

    if (action === 'atualizar-select') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Apenas administradores.', flags: MessageFlags.Ephemeral });
      }
      const teamId = parseInt(interaction.values[0]);
      const teamRes = await db.query('SELECT * FROM teams WHERE id = $1', [teamId]);
      if (teamRes.rows.length === 0) {
        return interaction.update({ content: 'Time não encontrado.', components: [] });
      }
      await updateLineupPost(interaction.guild, teamRes.rows[0]);
      return interaction.update({ content: `Lineup de **${teamRes.rows[0].name}** atualizada.`, components: [] });
    }

    const teamId = parseInt(parts[2]);
    const teamRes = await db.query('SELECT * FROM teams WHERE id = $1', [teamId]);
    if (teamRes.rows.length === 0) {
      return interaction.reply({ content: 'Time não encontrado.', flags: MessageFlags.Ephemeral });
    }
    const team = teamRes.rows[0];

    if (team.captain_discord_id !== interaction.user.id) {
      return interaction.reply({ content: 'Apenas o capitão pode editar a lineup deste time.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'editar') {
      const playersRes = await db.query(
        'SELECT discord_username FROM players WHERE team_id = $1 AND is_captain = false ORDER BY id ASC',
        [team.id]
      );
      const currentNames = playersRes.rows.map(p => p.discord_username);

      const modal = new ModalBuilder()
        .setCustomId(`lineup:submit:${team.id}`)
        .setTitle(`Editar lineup: ${team.name}`);

      for (let i = 0; i < MAX_NON_CAPTAIN_SLOTS; i++) {
        const input = new TextInputBuilder()
          .setCustomId(`jogador${i + 1}`)
          .setLabel(`Jogador ${i + 1}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(50);
        if (currentNames[i]) input.setValue(currentNames[i]);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
      }

      return interaction.showModal(modal);
    }

    if (action === 'submit') {
      const newNames = [];
      for (let i = 0; i < MAX_NON_CAPTAIN_SLOTS; i++) {
        const value = interaction.fields.getTextInputValue(`jogador${i + 1}`).trim();
        if (value) newNames.push(value);
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      await db.query('DELETE FROM players WHERE team_id = $1 AND is_captain = false', [team.id]);
      if (newNames.length > 0) {
        const placeholders = newNames.map((_, i) => `($1, $${i + 2}, false)`).join(', ');
        await db.query(
          `INSERT INTO players (team_id, discord_username, is_captain) VALUES ${placeholders}`,
          [team.id, ...newNames]
        );
      }

      await updateLineupPost(interaction.guild, team);
      updateTimesChannel(interaction.guild).catch(err => console.error('Erro ao atualizar #times:', err));
      return interaction.editReply({ content: `Lineup atualizada com ${newNames.length} jogador${newNames.length === 1 ? '' : 'es'} (sem contar o capitão).` });
    }
  },
};
