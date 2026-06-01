const { EmbedBuilder } = require('discord.js');
const db = require('../database');

const HIDDEN_TEAMS = ['Varsity', 'Amigas da Estella'];

async function updateTimesChannel(guild) {
  const channel = guild.channels.cache.find(c => c.name === 'times' || c.name.startsWith('times-'));
  if (!channel) return;

  const teamsResult = await db.query(
    'SELECT id, name, suspended_until FROM teams WHERE name NOT IN (' + HIDDEN_TEAMS.map((_, i) => `$${i + 1}`).join(', ') + ') ORDER BY name',
    HIDDEN_TEAMS
  );

  const msgs = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (msgs) {
    for (const msg of msgs.filter(m => m.author.bot).values()) {
      await msg.delete().catch(() => {});
    }
  }

  if (teamsResult.rows.length === 0) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x4fc3f7)
          .setTitle('Times cadastrados')
          .setDescription('Nenhum time cadastrado ainda.'),
      ],
    });
    return;
  }

  const fields = [];
  for (const team of teamsResult.rows) {
    const playersResult = await db.query(
      'SELECT discord_username, is_captain FROM players WHERE team_id = $1 ORDER BY is_captain DESC, id ASC',
      [team.id]
    );
    const players = playersResult.rows;
    const isSuspended = team.suspended_until && new Date(team.suspended_until) > new Date();

    const playerLines = players.length > 0
      ? players.map(p => `${p.is_captain ? '⭐' : '🎮'} ${p.discord_username}`).join('\n')
      : 'Sem jogadores cadastrados.';

    fields.push({
      name: isSuspended ? `${team.name} (suspenso)` : team.name,
      value: playerLines,
      inline: true,
    });
  }

  const total = teamsResult.rows.length;
  for (let i = 0; i < fields.length; i += 25) {
    const embed = new EmbedBuilder()
      .setColor(0x4fc3f7)
      .setTitle(i === 0 ? 'Times do servidor' : 'Times do servidor (continuação)')
      .addFields(fields.slice(i, i + 25))
      .setFooter({ text: `${total} time${total === 1 ? '' : 's'} cadastrado${total === 1 ? '' : 's'}` });
    await channel.send({ embeds: [embed] });
  }
}

module.exports = { updateTimesChannel };
