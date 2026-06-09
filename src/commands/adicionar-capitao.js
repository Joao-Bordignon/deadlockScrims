const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getCaptainTeam, getCaptainRole, getPlayerRole } = require('../utils/captain');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adicionar-capitao')
    .setDescription('Adiciona outro capitão ao seu time (acesso aos comandos do bot)')
    .addUserOption(opt =>
      opt.setName('usuario').setDescription('Usuário que receberá acesso de capitão').setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const team = await getCaptainTeam(interaction.member);
    if (!team) {
      return interaction.editReply({ content: 'Você precisa ser capitão de um time para usar este comando.' });
    }

    const target = interaction.options.getUser('usuario');
    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!targetMember) {
      return interaction.editReply({ content: 'Usuário não encontrado no servidor.' });
    }

    if (target.bot) {
      return interaction.editReply({ content: 'Não dá pra adicionar um bot como capitão.' });
    }

    const captainRole = getCaptainRole(interaction.guild);
    const playerRole = getPlayerRole(interaction.guild);
    const teamRole = interaction.guild.roles.cache.get(team.role_id);

    if (!captainRole) {
      return interaction.editReply({ content: 'Cargo `Capitão` não encontrado no servidor. Fale com um administrador.' });
    }
    if (!teamRole) {
      return interaction.editReply({ content: 'Cargo do time não encontrado. Fale com um administrador.' });
    }

    const alreadyTeam = targetMember.roles.cache.has(teamRole.id);
    const alreadyCaptain = targetMember.roles.cache.has(captainRole.id);
    if (alreadyTeam && alreadyCaptain) {
      return interaction.editReply({ content: `**${target.username}** já é capitão de **${team.name}**.` });
    }

    const rolesToAdd = [teamRole.id, captainRole.id];
    if (playerRole) rolesToAdd.push(playerRole.id);

    await targetMember.roles.add(rolesToAdd, `Adicionado como capitão de ${team.name} por ${interaction.user.tag}`);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x4caf82)
          .setTitle('Capitão adicionado')
          .setDescription(`**${target.username}** agora tem acesso aos comandos de **${team.name}**.`)
          .addFields({ name: 'Cargos atribuídos', value: `${teamRole.name}, ${captainRole.name}${playerRole ? `, ${playerRole.name}` : ''}` }),
      ],
    });

    const chatChannel = interaction.guild.channels.cache.get(team.channel_chat_id);
    if (chatChannel) {
      await chatChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x4caf82)
            .setTitle('Novo capitão')
            .setDescription(`<@${target.id}> agora também pode usar os comandos do time.`),
        ],
      }).catch(() => {});
    }
  },
};
