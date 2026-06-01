const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../database');

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
      players.map(p => `${p.is_captain ? '⭐' : '🎮'} ${p.discord_username}${p.is_captain ? ' (Capitão)' : ''}`).join('\n') || 'Sem jogadores cadastrados.'
    )
    .setFooter({ text: `${players.length} jogadores · Use /lineup add ou /lineup remove para editar` });

  await channel.send({ embeds: [embed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lineup')
    .setDescription('Gerencia a lineup do seu time')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Adiciona um jogador à lineup')
        .addStringOption(opt => opt.setName('jogador').setDescription('Nome do jogador').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove um jogador da lineup')
        .addStringOption(opt => opt.setName('jogador').setDescription('Nome do jogador').setRequired(true))
    )
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

    const playerName = interaction.options.getString('jogador').trim();

    if (subcommand === 'add') {
      const existing = await db.query(
        'SELECT id FROM players WHERE team_id = $1 AND discord_username ILIKE $2',
        [team.id, playerName]
      );
      if (existing.rows.length > 0) {
        return interaction.reply({ content: `**${playerName}** já está na lineup.`, flags: MessageFlags.Ephemeral });
      }

      await db.query(
        'INSERT INTO players (team_id, discord_username, is_captain) VALUES ($1, $2, false)',
        [team.id, playerName]
      );
      await updateLineupPost(interaction.guild, team);
      return interaction.reply({ content: `**${playerName}** adicionado à lineup.`, flags: MessageFlags.Ephemeral });
    }

    if (subcommand === 'remove') {
      const player = await db.query(
        'SELECT id, is_captain FROM players WHERE team_id = $1 AND discord_username ILIKE $2',
        [team.id, playerName]
      );
      if (player.rows.length === 0) {
        return interaction.reply({ content: `**${playerName}** não está na lineup.`, flags: MessageFlags.Ephemeral });
      }
      if (player.rows[0].is_captain) {
        return interaction.reply({ content: 'O capitão não pode ser removido da lineup.', flags: MessageFlags.Ephemeral });
      }

      await db.query('DELETE FROM players WHERE id = $1', [player.rows[0].id]);
      await updateLineupPost(interaction.guild, team);
      return interaction.reply({ content: `**${playerName}** removido da lineup.`, flags: MessageFlags.Ephemeral });
    }
  },
};
