const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const db = require('../database');
const { DAY_NAME, formatDate, HOUR_TIME } = require('../utils/time');

function startExpirationCron(client) {
  cron.schedule('* * * * *', async () => {
    try {
      const result = await db.query(
        `UPDATE scrims SET status = 'expired'
         WHERE status = 'pending' AND expires_at < NOW()
         RETURNING *`
      );

      if (result.rows.length === 0) return;

      for (const scrim of result.rows) {
        const teams = await db.query('SELECT * FROM teams WHERE id IN ($1, $2)', [scrim.team_home_id, scrim.team_away_id]);
        const home = teams.rows.find(t => t.id === scrim.team_home_id);
        const away = teams.rows.find(t => t.id === scrim.team_away_id);

        const expiredEmbed = new EmbedBuilder()
          .setColor(0x808080)
          .setTitle('Proposta expirada')
          .addFields(
            { name: 'Partida', value: `${home.name} vs ${away.name}` },
            { name: 'Data e hora', value: `${DAY_NAME[scrim.day_of_week]} ${formatDate(new Date(scrim.scheduled_at))} · ${HOUR_TIME(scrim.hour)}` },
          )
          .setFooter({ text: 'Sem resposta até 2h antes da scrim' });

        if (scrim.proposal_channel_id && scrim.proposal_message_id) {
          const channel = await client.channels.fetch(scrim.proposal_channel_id).catch(() => null);
          if (channel) {
            const message = await channel.messages.fetch(scrim.proposal_message_id).catch(() => null);
            if (message) await message.edit({ content: '', embeds: [expiredEmbed], components: [] }).catch(() => {});
          }
        }

        // Notifica o time que propôs
        const proposerPropostas = home.channel_propostas_id ? await client.channels.fetch(home.channel_propostas_id).catch(() => null) : null;
        if (proposerPropostas) {
          await proposerPropostas.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x808080)
                .setTitle('Sua proposta expirou')
                .addFields(
                  { name: 'Adversário', value: away.name },
                  { name: 'Data e hora', value: `${DAY_NAME[scrim.day_of_week]} ${formatDate(new Date(scrim.scheduled_at))} · ${HOUR_TIME(scrim.hour)}` },
                ),
            ],
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Erro no cron de expiração:', err);
    }
  });
  console.log('Cron de expiração iniciado.');
}

module.exports = { startExpirationCron };
