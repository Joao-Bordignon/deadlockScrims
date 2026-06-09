const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getCaptainTeam, getCaptainRole } = require('../utils/captain');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remover-capitao')
    .setDescription('Remove o acesso de capitão de outro jogador do seu time')
    .addUserOption(opt =>
      opt.setName('usuario').setDescription('Usuário que perderá o acesso de capitão').setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const team = await getCaptainTeam(interaction.member);
    if (!team) {
      return interaction.editReply({ content: 'Você precisa ser capitão de um time para usar este comando.' });
    }

    const target = interaction.options.getUser('usuario');

    if (target.id === team.captain_discord_id) {
      return interaction.editReply({ content: 'Não dá pra remover o capitão fundador do time. Para isso, fale com um administrador.' });
    }

    if (target.id === interaction.user.id) {
      return interaction.editReply({ content: 'Você não pode remover seu próprio acesso de capitão.' });
    }

    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!targetMember) {
      return interaction.editReply({ content: 'Usuário não encontrado no servidor.' });
    }

    const captainRole = getCaptainRole(interaction.guild);
    if (!captainRole) {
      return interaction.editReply({ content: 'Cargo `Capitão` não encontrado no servidor.' });
    }

    if (!targetMember.roles.cache.has(captainRole.id)) {
      return interaction.editReply({ content: `**${target.username}** não tem acesso de capitão.` });
    }

    const targetTeamRoles = targetMember.roles.cache.filter(r => r.id === team.role_id);
    if (targetTeamRoles.size === 0) {
      return interaction.editReply({ content: `**${target.username}** não faz parte de **${team.name}**.` });
    }

    await targetMember.roles.remove(captainRole.id, `Removido como capitão de ${team.name} por ${interaction.user.tag}`);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe05a5a)
          .setTitle('Acesso de capitão removido')
          .setDescription(`**${target.username}** não pode mais usar os comandos de **${team.name}**. Continua no time como jogador.`),
      ],
    });

    const chatChannel = interaction.guild.channels.cache.get(team.channel_chat_id);
    if (chatChannel) {
      await chatChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe05a5a)
            .setTitle('Acesso de capitão removido')
            .setDescription(`<@${target.id}> não tem mais acesso aos comandos do time.`),
        ],
      }).catch(() => {});
    }
  },
};
