const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const db = require('../database');
const { updateTimesChannel } = require('../utils/times');

const PRIVATE_CHANNELS = [
  { name: 'comandos', type: ChannelType.GuildText },
  { name: 'chat-do-time', type: ChannelType.GuildText },
  { name: 'agenda', type: ChannelType.GuildText },
  { name: 'historico-de-partidas', type: ChannelType.GuildText },
  { name: 'lineup', type: ChannelType.GuildText },
  { name: 'propostas', type: ChannelType.GuildText },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cadastrar-time')
    .setDescription('Cadastra seu time no servidor')
    .addStringOption(opt =>
      opt.setName('nome').setDescription('Nome do time').setRequired(true)
    )
    .addStringOption(opt => opt.setName('jogador1').setDescription('Nome do jogador 1').setRequired(true))
    .addStringOption(opt => opt.setName('jogador2').setDescription('Nome do jogador 2').setRequired(true))
    .addStringOption(opt => opt.setName('jogador3').setDescription('Nome do jogador 3').setRequired(true))
    .addStringOption(opt => opt.setName('jogador4').setDescription('Nome do jogador 4').setRequired(true))
    .addStringOption(opt => opt.setName('jogador5').setDescription('Nome do jogador 5').setRequired(true))
    .addStringOption(opt => opt.setName('jogador6').setDescription('Nome do jogador 6').setRequired(true)),

  async execute(interaction) {
    const captainRole = interaction.guild.roles.cache.find(r => r.name === 'Capitão');
    if (!captainRole || !interaction.member.roles.cache.has(captainRole.id)) {
      return interaction.reply({
        content: 'Você precisa do cargo **Capitão** para cadastrar um time. Fale com um administrador.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const teamName = interaction.options.getString('nome');
    const playerNames = [1, 2, 3, 4, 5, 6].map(n => interaction.options.getString(`jogador${n}`));
    const guild = interaction.guild;

    const existing = await db.query('SELECT id FROM teams WHERE name ILIKE $1', [teamName]);
    if (existing.rows.length > 0) {
      return interaction.editReply({ content: `Já existe um time com o nome **${teamName}**.` });
    }

    // Cria o cargo do time
    const teamRole = await guild.roles.create({
      name: teamName,
      color: 0x4fc3f7,
      reason: `Time cadastrado: ${teamName}`,
    });

    // Atribui o cargo do time ao capitão
    await interaction.member.roles.add(teamRole);

    // Define permissões da categoria privada
    const permissionOverwrites = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: teamRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ];

    const adminRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.Administrator));
    if (adminRole) {
      permissionOverwrites.push({
        id: adminRole.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      });
    }

    // Cria a categoria privada
    const category = await guild.channels.create({
      name: teamName.toUpperCase(),
      type: ChannelType.GuildCategory,
      permissionOverwrites,
    });

    // Cria os 5 canais dentro da categoria
    const channelIds = {};
    for (const ch of PRIVATE_CHANNELS) {
      const channel = await guild.channels.create({
        name: ch.name,
        type: ch.type,
        parent: category.id,
      });
      channelIds[ch.name] = channel.id;
    }

    // Salva o time no banco
    const result = await db.query(
      `INSERT INTO teams (name, captain_discord_id, role_id, category_id, channel_chat_id, channel_agenda_id, channel_historico_id, channel_lineup_id, channel_propostas_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        teamName,
        interaction.user.id,
        teamRole.id,
        category.id,
        channelIds['chat-do-time'],
        channelIds['agenda'],
        channelIds['historico-de-partidas'],
        channelIds['lineup'],
        channelIds['propostas'],
      ]
    );

    const teamId = result.rows[0].id;

    // Salva os jogadores pelo nome
    for (let i = 0; i < playerNames.length; i++) {
      await db.query(
        'INSERT INTO players (team_id, discord_username, is_captain) VALUES ($1, $2, $3)',
        [teamId, playerNames[i], i === 0]
      );
    }

    // Confirmação no #chat-do-time
    const chatChannel = guild.channels.cache.get(channelIds['chat-do-time']);
    if (chatChannel) {
      const confirmEmbed = new EmbedBuilder()
        .setColor(0x4caf82)
        .setTitle('Time cadastrado com sucesso!')
        .addFields({ name: 'Time', value: teamName })
        .setFooter({ text: 'Use /disponibilidade no canal #agenda para cadastrar seus horários' });
      await chatChannel.send({ embeds: [confirmEmbed] });
    }

    // Guia do bot no #comandos
    const comandosChannel = guild.channels.cache.get(channelIds['comandos']);
    if (comandosChannel) {
      const guideEmbed = new EmbedBuilder()
        .setColor(0x4fc3f7)
        .setTitle('Guia do Bot')
        .setDescription('Tudo que você precisa saber para usar o Deadlock Scrims.')
        .addFields(
          {
            name: '/disponibilidade',
            value: 'Cadastra ou edita os dias e horários disponíveis do time para a semana. Use no <#' + channelIds['agenda'] + '>.',
          },
          {
            name: '/cancelar-scrim',
            value: 'Cancela uma scrim confirmada. Mínimo de 2h de antecedência. Use no <#' + channelIds['agenda'] + '>.',
          },
          {
            name: 'Botão "Editar disponibilidade"',
            value: 'Aparece no <#' + channelIds['agenda'] + '> após o primeiro cadastro. Permite atualizar os horários a qualquer momento.',
          },
          {
            name: 'Botão "Propor para [time]"',
            value: 'Aparece no canal público #disponibilidade. Seleciona o time, depois o dia e o horário disponível.',
          },
          {
            name: 'Botões Aceitar / Recusar',
            value: 'Aparecem em <#' + channelIds['propostas'] + '> quando outro time envia uma proposta de scrim.',
          },
          {
            name: 'Botão "Editar lineup"',
            value: 'Aparece no <#' + channelIds['lineup'] + '>. Abre um formulário com os 5 slots de jogadores (sem contar o capitão) para você adicionar, remover ou trocar.',
          },
        )
        .setFooter({ text: 'Apenas o capitão pode usar os comandos do time' });

      const channelsEmbed = new EmbedBuilder()
        .setColor(0x7c6af7)
        .setTitle('Canais do time')
        .addFields(
          { name: '<#' + channelIds['chat-do-time'] + '>', value: 'Conversa geral do time. Lembretes 3h antes das scrims aparecem aqui.' },
          { name: '<#' + channelIds['agenda'] + '>', value: 'Disponibilidade da semana e scrims confirmadas.' },
          { name: '<#' + channelIds['propostas'] + '>', value: 'Propostas de scrim recebidas e enviadas, com status de aceite, recusa, expiração e cancelamento.' },
          { name: '<#' + channelIds['lineup'] + '>', value: 'Jogadores cadastrados no time.' },
          { name: '<#' + channelIds['historico-de-partidas'] + '>', value: 'Histórico das partidas jogadas.' },
        );

      const regrasEmbed = new EmbedBuilder()
        .setColor(0xe05a5a)
        .setTitle('Regras importantes')
        .setDescription(
          '**Comandos**\n' +
          '• Apenas o capitão pode usar os comandos do time.\n' +
          '• A disponibilidade pode ser cadastrada para até 3 semanas (atual, próxima e seguinte).\n' +
          '• Cada semana é independente. Toda segunda, rode `/disponibilidade` para cadastrar a nova semana que entrou.\n\n' +
          '**Propostas**\n' +
          '• Propostas de scrim expiram automaticamente 2h antes do horário marcado (ou 30min antes, se a proposta foi feita com pouca antecedência).\n' +
          '• Cada proposta envolve apenas os dois times. Não há interferência externa.\n\n' +
          '**Cancelamentos**\n' +
          'O prazo de cancelamento varia conforme a antecedência do agendamento:\n' +
          '• Marcada com 72h+ de antecedência → cancela até 48h antes\n' +
          '• Marcada com 24h a 72h de antecedência → cancela até 12h antes\n' +
          '• Marcada com 6h a 24h de antecedência → cancela até 5h antes\n' +
          '• Marcada com menos de 6h → cancela até metade do tempo restante (mínimo 30min)\n\n' +
          '**Lembretes**\n' +
          '• O bot envia um lembrete 3h antes de cada scrim no chat do time.\n' +
          '• Os canais públicos são atualizados todo dia às 8h da manhã automaticamente.\n\n' +
          '**Convivência**\n' +
          '• Mantenha o respeito com adversários nos canais públicos e propostas.\n' +
          '• Cancelamentos repetidos ou no-shows podem resultar em suspensão do time.'
        );

      await comandosChannel.send({ embeds: [guideEmbed, channelsEmbed, regrasEmbed] });
    }

    const teamRecord = {
      id: teamId,
      name: teamName,
      channel_lineup_id: channelIds['lineup'],
      channel_agenda_id: channelIds['agenda'],
      channel_chat_id: channelIds['chat-do-time'],
      channel_propostas_id: channelIds['propostas'],
      captain_discord_id: interaction.user.id,
    };

    // Lineup no #lineup (usa o helper para incluir o botão "Editar lineup")
    const lineup = require('./lineup');
    await lineup.updateLineupPost(guild, teamRecord);

    // Cria os 3 posts de disponibilidade no #agenda do time (vazios, prontos pra edição)
    const disponibilidade = require('./disponibilidade');
    await disponibilidade.postAllAvailabilityToAgenda(guild, teamRecord);

    await interaction.editReply({ content: `Time **${teamName}** cadastrado! Verifique o canal <#${channelIds['chat-do-time']}>.` });

    updateTimesChannel(guild).catch(err => console.error('Erro ao atualizar #times:', err));
  },
};
