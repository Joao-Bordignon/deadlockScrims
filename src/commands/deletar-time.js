const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const disponibilidade = require('./disponibilidade');
const { updateTimesChannel } = require('../utils/times');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deletar-time')
    .setDescription('Remove um time, seus canais, cargo e dados (apenas administradores)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Apenas administradores podem usar este comando.', flags: MessageFlags.Ephemeral });
    }

    const teams = await db.query('SELECT id, name FROM teams ORDER BY name');
    if (teams.rows.length === 0) {
      return interaction.reply({ content: 'Não há times cadastrados.', flags: MessageFlags.Ephemeral });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('deletar-time:select')
      .setPlaceholder('Selecione o time a ser deletado')
      .addOptions(teams.rows.slice(0, 25).map(t => ({ label: t.name, value: String(t.id) })));

    await interaction.reply({
      content: 'Qual time deseja deletar?',
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
  },

  async handleComponent(interaction) {
    const parts = interaction.customId.split(':');
    const action = parts[1];

    if (action === 'select') {
      const teamId = parseInt(interaction.values[0]);
      const r = await db.query('SELECT * FROM teams WHERE id = $1', [teamId]);
      if (r.rows.length === 0) {
        return interaction.update({ content: 'Time não encontrado.', components: [] });
      }
      const team = r.rows[0];

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`deletar-time:confirm:${team.id}`).setLabel('Confirmar exclusão').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('deletar-time:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      );

      return interaction.update({
        content: `Tem certeza que quer deletar **${team.name}**? Isso vai remover a categoria, todos os canais, o cargo e os dados do banco.`,
        components: [row],
      });
    }

    if (action === 'cancel') {
      return interaction.update({ content: 'Exclusão cancelada.', components: [] });
    }

    if (action === 'confirm') {
      const teamId = parseInt(parts[2]);
      const r = await db.query('SELECT * FROM teams WHERE id = $1', [teamId]);
      if (r.rows.length === 0) {
        return interaction.update({ content: 'Time não encontrado.', components: [] });
      }
      const team = r.rows[0];

      await interaction.deferUpdate();

      const guild = interaction.guild;

      // Remove canais da categoria
      const category = guild.channels.cache.get(team.category_id) || await guild.channels.fetch(team.category_id).catch(() => null);
      if (category) {
        const children = guild.channels.cache.filter(c => c.parentId === team.category_id);
        for (const ch of children.values()) await ch.delete().catch(() => {});
        await category.delete().catch(() => {});
      }

      // Remove o cargo
      const role = guild.roles.cache.get(team.role_id) || await guild.roles.fetch(team.role_id).catch(() => null);
      if (role) await role.delete().catch(() => {});

      // Limpa dados do banco (scrims envolvendo o time e disponibilidade do time)
      const scrims = await db.query('SELECT week_start FROM scrims WHERE team_home_id = $1 OR team_away_id = $1', [teamId]);
      const affectedWeeks = new Set(scrims.rows.map(s => s.week_start.toISOString().slice(0, 10)));

      await db.query('DELETE FROM match_history WHERE team_id = $1', [teamId]);
      await db.query('DELETE FROM scrims WHERE team_home_id = $1 OR team_away_id = $1', [teamId]);
      await db.query('DELETE FROM availabilities WHERE team_id = $1', [teamId]);
      await db.query('DELETE FROM players WHERE team_id = $1', [teamId]);
      await db.query('DELETE FROM teams WHERE id = $1', [teamId]);

      await interaction.editReply({
        content: `Time **${team.name}** removido.`,
        components: [],
      });

      // Atualiza #disponibilidade da semana atual
      const weekStart = new Date();
      const day = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
      weekStart.setHours(0, 0, 0, 0);
      disponibilidade.updateDisponibilidadeChannel(guild, weekStart).catch(() => {});
      updateTimesChannel(guild).catch(err => console.error('Erro ao atualizar #times:', err));
    }
  },
};
