const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const db = require('../database');

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
    const captainRole = interaction.guild.roles.cache.find(r => r.name === 'Capitão');
    if (!captainRole || !interaction.member.roles.cache.has(captainRole.id)) {
      return interaction.reply({ content: 'Apenas o capitão pode gerenciar a lineup.', flags: MessageFlags.Ephemeral });
    }

    const teamRes = await db.query('SELECT * FROM teams WHERE captain_discord_id = $1', [interaction.user.id]);
    if (teamRes.rows.length === 0) {
      return interaction.reply({ content: 'Você não tem um time cadastrado.', flags: MessageFlags.Ephemeral });
    }
    const team = teamRes.rows[0];

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'atualizar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateLineupPost(interaction.guild, team);
      return interaction.editReply({ content: 'Lineup atualizada.' });
    }
  },

  async handleComponent(interaction) {
    const parts = interaction.customId.split(':');
    const action = parts[1];
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
      return interaction.editReply({ content: `Lineup atualizada com ${newNames.length} jogador${newNames.length === 1 ? '' : 'es'} (sem contar o capitão).` });
    }
  },
};
