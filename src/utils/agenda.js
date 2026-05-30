const { EmbedBuilder } = require('discord.js');
const db = require('../database');
const { HOUR_TIME, DAY_NAME, formatWeekRange, getWeekStart } = require('./time');

async function updateAgendaChannel(guild, team, weekStart) {
  const agendaChannel = guild.channels.cache.get(team.channel_agenda_id);
  if (!agendaChannel) return;

  const result = await db.query(
    `SELECT s.id, s.day_of_week, s.hour, s.team_home_id, s.team_away_id,
            h.name AS home_name, a.name AS away_name
     FROM scrims s
     JOIN teams h ON h.id = s.team_home_id
     JOIN teams a ON a.id = s.team_away_id
     WHERE s.week_start = $1
       AND s.status = 'confirmed'
       AND (s.team_home_id = $2 OR s.team_away_id = $2)
     ORDER BY s.day_of_week, s.hour`,
    [weekStart, team.id]
  );

  // Remove agenda anterior
  const msgs = await agendaChannel.messages.fetch({ limit: 30 }).catch(() => null);
  if (msgs) {
    for (const msg of msgs.filter(m => m.author.bot && m.embeds[0]?.title?.startsWith('Agenda:')).values()) {
      await msg.delete().catch(() => {});
    }
  }

  // Monta scrims agrupadas por day_of_week
  const scrimsByDay = {};
  for (const row of result.rows) {
    if (!scrimsByDay[row.day_of_week]) scrimsByDay[row.day_of_week] = [];
    const opponent = row.team_home_id === team.id ? row.away_name : row.home_name;
    scrimsByDay[row.day_of_week].push({ hour: row.hour, opponent });
  }

  // Ordem de exibição: Seg, Ter, Qua, Qui, Sex, Sáb, Dom
  const displayOrder = [1, 2, 3, 4, 5, 6, 0];
  const lines = displayOrder.map(d => {
    const dayName = DAY_NAME[d].padEnd(15, ' ');
    if (!scrimsByDay[d] || scrimsByDay[d].length === 0) {
      return `\`${dayName}\` sem scrim`;
    }
    const scrimsStr = scrimsByDay[d]
      .map(s => `⚔️ ${HOUR_TIME(s.hour)} vs ${s.opponent}`)
      .join(' · ');
    return `\`${dayName}\` ${scrimsStr}`;
  });

  const totalScrims = result.rows.length;

  const embed = new EmbedBuilder()
    .setColor(0x7c6af7)
    .setTitle(`Agenda: ${team.name}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${totalScrims} scrim${totalScrims === 1 ? '' : 's'} marcada${totalScrims === 1 ? '' : 's'} · Semana ${formatWeekRange(weekStart)}` });

  await agendaChannel.send({ embeds: [embed] });
}

module.exports = { updateAgendaChannel };
