const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const db = require('../database');
const { DAY_NAME, HOUR_TIME, formatDate } = require('../utils/time');

function startReminderCron(client) {
  cron.schedule('* * * * *', async () => {
    try {
      // Scrims confirmadas, sem lembrete enviado, dentro das próximas 3h
      const result = await db.query(
        `SELECT s.*, h.name AS home_name, a.name AS away_name,
                h.channel_chat_id AS home_chat, a.channel_chat_id AS away_chat,
                h.role_id AS home_role, a.role_id AS away_role
         FROM scrims s
         JOIN teams h ON h.id = s.team_home_id
         JOIN teams a ON a.id = s.team_away_id
         WHERE s.status = 'confirmed'
           AND s.reminder_sent = false
           AND s.scheduled_at > NOW()
           AND s.scheduled_at <= NOW() + INTERVAL '3 hours'`
      );

      if (result.rows.length === 0) return;

      for (const scrim of result.rows) {
        const scheduledAt = new Date(scrim.scheduled_at);
        const cancelDeadline = new Date(scheduledAt.getTime() - 2 * 60 * 60 * 1000);
        const cancelDeadlineStr = `${HOUR_TIME(cancelDeadline.getHours())}`;

        const teams = [
          { chatId: scrim.home_chat, roleId: scrim.home_role, name: scrim.home_name, opponent: scrim.away_name },
          { chatId: scrim.away_chat, roleId: scrim.away_role, name: scrim.away_name, opponent: scrim.home_name },
        ];

        for (const t of teams) {
          if (!t.chatId) continue;
          const channel = await client.channels.fetch(t.chatId).catch(() => null);
          if (!channel) continue;

          const embed = new EmbedBuilder()
            .setColor(0xffaa00)
            .setTitle(`Scrim em 3 horas: ${HOUR_TIME(scrim.hour)}`)
            .addFields(
              { name: 'Adversário', value: t.opponent },
              { name: 'Horário', value: `${DAY_NAME[scrim.day_of_week]} · ${formatDate(scheduledAt)} · ${HOUR_TIME(scrim.hour)}` },
              { name: 'Aviso', value: `Cancelamentos somente até as ${cancelDeadlineStr} (2h antes da scrim). Após esse horário a partida não poderá ser cancelada.` },
            )
            .setFooter({ text: 'Use /cancelar-scrim se necessário' });

          const mention = t.roleId ? `<@&${t.roleId}> lembrete de scrim em 3 horas!` : 'Lembrete de scrim em 3 horas!';
          await channel.send({ content: mention, embeds: [embed] }).catch(() => {});
        }

        await db.query('UPDATE scrims SET reminder_sent = true WHERE id = $1', [scrim.id]);
      }
    } catch (err) {
      console.error('Erro no cron de lembretes:', err);
    }
  });
  console.log('Cron de lembretes iniciado.');
}

module.exports = { startReminderCron };
