const { EmbedBuilder } = require('discord.js');
const db = require('../database');
const {
  HOUR_TIME, SHORT_DAY, formatDate, formatWeekRange,
  getActiveWeekStarts, weekLabel, dayOffsetFromMonday,
} = require('./time');

async function updateAgendaChannel(guild, team) {
  const agendaChannel = guild.channels.cache.get(team.channel_agenda_id);
  if (!agendaChannel) return;

  const weekStarts = getActiveWeekStarts();
  const firstWeek = weekStarts[0];
  const lastWeek = weekStarts[weekStarts.length - 1];
  const horizonEnd = new Date(lastWeek);
  horizonEnd.setDate(horizonEnd.getDate() + 7);

  const result = await db.query(
    `SELECT s.id, s.week_start, s.day_of_week, s.hour, s.team_home_id, s.team_away_id,
            h.name AS home_name, a.name AS away_name
     FROM scrims s
     JOIN teams h ON h.id = s.team_home_id
     JOIN teams a ON a.id = s.team_away_id
     WHERE s.week_start >= $1 AND s.week_start < $2
       AND s.status = 'confirmed'
       AND (s.team_home_id = $3 OR s.team_away_id = $3)
     ORDER BY s.week_start, s.day_of_week, s.hour`,
    [firstWeek, horizonEnd, team.id]
  );

  // Remove agendas anteriores
  const msgs = await agendaChannel.messages.fetch({ limit: 30 }).catch(() => null);
  if (msgs) {
    for (const msg of msgs.filter(m => m.author.bot && m.embeds[0]?.title?.startsWith('Agenda:')).values()) {
      await msg.delete().catch(() => {});
    }
  }

  // Agrupa scrims por week_start + day_of_week
  const scrimsByWeekDay = {};
  for (const row of result.rows) {
    const weekKey = new Date(row.week_start).getTime();
    if (!scrimsByWeekDay[weekKey]) scrimsByWeekDay[weekKey] = {};
    if (!scrimsByWeekDay[weekKey][row.day_of_week]) scrimsByWeekDay[weekKey][row.day_of_week] = [];
    const opponent = row.team_home_id === team.id ? row.away_name : row.home_name;
    scrimsByWeekDay[weekKey][row.day_of_week].push({ hour: row.hour, opponent });
  }

  const displayOrder = [1, 2, 3, 4, 5, 6, 0]; // Seg → Dom
  const sections = [];
  let totalScrims = 0;

  weekStarts.forEach((weekStart, idx) => {
    const weekKey = weekStart.getTime();
    const weekScrims = scrimsByWeekDay[weekKey] || {};

    const lines = displayOrder.map(d => {
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + dayOffsetFromMonday(d));
      const dateStr = formatDate(dayDate);
      const shortDay = SHORT_DAY[d];
      const prefix = `\`${dateStr} ${shortDay}\``;

      if (!weekScrims[d] || weekScrims[d].length === 0) {
        return `${prefix} sem scrim`;
      }

      totalScrims += weekScrims[d].length;
      const scrimsStr = weekScrims[d]
        .map(s => `⚔️ ${HOUR_TIME(s.hour)} vs ${s.opponent}`)
        .join(' · ');
      return `${prefix} ${scrimsStr}`;
    });

    sections.push(`**${weekLabel(idx)}** · ${formatWeekRange(weekStart)}\n${lines.join('\n')}`);
  });

  const embed = new EmbedBuilder()
    .setColor(0x7c6af7)
    .setTitle(`Agenda: ${team.name}`)
    .setDescription(sections.join('\n\n'))
    .setFooter({ text: `${totalScrims} scrim${totalScrims === 1 ? '' : 's'} marcada${totalScrims === 1 ? '' : 's'} nas próximas 3 semanas` });

  await agendaChannel.send({ embeds: [embed] });
}

module.exports = { updateAgendaChannel };
