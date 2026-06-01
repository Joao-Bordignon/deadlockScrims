const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { updateTimesChannel } = require('../utils/times');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('atualizar-times')
    .setDescription('Atualiza o canal #times com a lista atual de times e lineups (apenas administradores)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Apenas administradores podem usar este comando.', flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.guild.channels.cache.find(c => c.name === 'times' || c.name.startsWith('times-'));
    if (!channel) {
      return interaction.reply({ content: 'Não encontrei o canal #times. Crie um canal com esse nome primeiro.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await updateTimesChannel(interaction.guild);
    await interaction.editReply({ content: `Canal <#${channel.id}> atualizado.` });
  },
};
