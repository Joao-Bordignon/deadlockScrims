const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const disponibilidade = require('./disponibilidade');
const { updateTimesChannel } = require('../utils/times');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remover-suspensao')
    .setDescription('Reativa um time suspenso (apenas administradores)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Apenas administradores podem usar este comando.', flags: MessageFlags.Ephemeral });
    }

    const teams = await db.query(
      'SELECT id, name, suspended_until, suspension_reason FROM teams WHERE suspended_until IS NOT NULL AND suspended_until > NOW() ORDER BY name'
    );
    if (teams.rows.length === 0) {
      return interaction.reply({ content: 'Não há times suspensos no momento.', flags: MessageFlags.Ephemeral });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('remover-suspensao:select')
      .setPlaceholder('Selecione o time para reativar')
      .addOptions(teams.rows.slice(0, 25).map(t => ({ label: t.name, value: String(t.id) })));

    await interaction.reply({
      content: 'Qual time deseja reativar?',
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
  },

  async handleComponent(interaction) {
    const parts = interaction.customId.split(':');
    if (parts[1] !== 'select') return;

    const teamId = parseInt(interaction.values[0]);
    const teamResult = await db.query('SELECT * FROM teams WHERE id = $1', [teamId]);
    if (teamResult.rows.length === 0) {
      return interaction.update({ content: 'Time não encontrado.', components: [] });
    }
    const team = teamResult.rows[0];

    await db.query('UPDATE teams SET suspended_until = NULL, suspension_reason = NULL WHERE id = $1', [teamId]);

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x4caf82)
          .setTitle(`Suspensão removida: ${team.name}`)
          .setDescription('O time pode voltar a propor e receber scrims.'),
      ],
      content: '',
      components: [],
    });

    const chatChannel = interaction.guild.channels.cache.get(team.channel_chat_id);
    if (chatChannel) {
      await chatChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x4caf82)
            .setTitle('Suspensão removida')
            .setDescription('O time foi reativado e pode voltar a participar de scrims.'),
        ],
      }).catch(() => {});
    }

    disponibilidade.updateAllDisponibilidadeChannel(interaction.guild).catch(() => {});
    updateTimesChannel(interaction.guild).catch(err => console.error('Erro ao atualizar #times:', err));
  },
};
