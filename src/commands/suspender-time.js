const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const db = require('../database');
const disponibilidade = require('./disponibilidade');
const { updateTimesChannel } = require('../utils/times');

const INDEFINITE_DATE = new Date('9999-01-01T00:00:00Z');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suspender-time')
    .setDescription('Suspende um time, impedindo que participe de scrims (apenas administradores)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Apenas administradores podem usar este comando.', flags: MessageFlags.Ephemeral });
    }

    const teams = await db.query(
      'SELECT id, name FROM teams WHERE suspended_until IS NULL OR suspended_until < NOW() ORDER BY name'
    );
    if (teams.rows.length === 0) {
      return interaction.reply({ content: 'Não há times ativos para suspender.', flags: MessageFlags.Ephemeral });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('suspender-time:select')
      .setPlaceholder('Selecione o time')
      .addOptions(teams.rows.slice(0, 25).map(t => ({ label: t.name, value: String(t.id) })));

    await interaction.reply({
      content: 'Qual time deseja suspender?',
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
  },

  async handleComponent(interaction) {
    const parts = interaction.customId.split(':');
    const action = parts[1];

    if (action === 'select') {
      const teamId = interaction.values[0];

      const modal = new ModalBuilder()
        .setCustomId(`suspender-time:submit:${teamId}`)
        .setTitle('Suspender time')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('dias')
              .setLabel('Duração em dias (vazio = indefinido)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setPlaceholder('Ex: 7'),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('motivo')
              .setLabel('Motivo da suspensão')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(500),
          ),
        );

      return interaction.showModal(modal);
    }

    if (action === 'submit') {
      const teamId = parseInt(parts[2]);
      const teamResult = await db.query('SELECT * FROM teams WHERE id = $1', [teamId]);
      if (teamResult.rows.length === 0) {
        return interaction.reply({ content: 'Time não encontrado.', flags: MessageFlags.Ephemeral });
      }
      const team = teamResult.rows[0];

      const diasStr = interaction.fields.getTextInputValue('dias').trim();
      const motivo = interaction.fields.getTextInputValue('motivo').trim();
      const dias = diasStr ? parseInt(diasStr) : null;

      if (diasStr && (isNaN(dias) || dias <= 0)) {
        return interaction.reply({ content: 'Duração inválida. Use um número inteiro positivo ou deixe vazio para suspensão indefinida.', flags: MessageFlags.Ephemeral });
      }

      const suspendedUntil = dias ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : INDEFINITE_DATE;

      await db.query(
        'UPDATE teams SET suspended_until = $1, suspension_reason = $2 WHERE id = $3',
        [suspendedUntil, motivo, teamId]
      );

      const duracaoStr = dias ? `${dias} dia${dias === 1 ? '' : 's'} (até ${suspendedUntil.toLocaleDateString('pt-BR')})` : 'Indefinida';

      const confirmEmbed = new EmbedBuilder()
        .setColor(0xe05a5a)
        .setTitle(`Time suspenso: ${team.name}`)
        .addFields(
          { name: 'Duração', value: duracaoStr },
          { name: 'Motivo', value: motivo },
        )
        .setFooter({ text: 'Use /remover-suspensao para reativar antes do prazo' });

      await interaction.reply({ embeds: [confirmEmbed], flags: MessageFlags.Ephemeral });

      // Notifica o time no chat
      const chatChannel = interaction.guild.channels.cache.get(team.channel_chat_id);
      if (chatChannel) {
        await chatChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe05a5a)
              .setTitle('Seu time foi suspenso')
              .setDescription('O time não poderá propor scrims, receber propostas ou aparecer na lista de disponibilidade enquanto estiver suspenso.')
              .addFields(
                { name: 'Duração', value: duracaoStr },
                { name: 'Motivo', value: motivo },
              ),
          ],
        }).catch(() => {});
      }

      // Atualiza #disponibilidade para remover o time
      const weekStart = new Date();
      const day = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
      weekStart.setHours(0, 0, 0, 0);
      disponibilidade.updateDisponibilidadeChannel(interaction.guild, weekStart).catch(() => {});
      updateTimesChannel(interaction.guild).catch(err => console.error('Erro ao atualizar #times:', err));
    }
  },
};
