const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const db = require('../database');
const disponibilidade = require('../commands/disponibilidade');
const { getWeekStart, formatWeekRange } = require('../utils/time');
const { updateTimesChannel } = require('../utils/times');

async function refreshWeek(client) {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const newWeekStart = getWeekStart();

  const teams = await db.query('SELECT * FROM teams WHERE suspended_until IS NULL OR suspended_until < NOW()');

  for (const team of teams.rows) {
    // Atualiza os 3 posts de disponibilidade no #agenda do time
    await disponibilidade.postAllAvailabilityToAgenda(guild, team)
      .catch(err => console.error(`Erro post #agenda ${team.name}:`, err));

    // Lembrete no #chat-do-time
    const chatChannel = guild.channels.cache.get(team.channel_chat_id);
    if (chatChannel) {
      const captainMention = `<@${team.captain_discord_id}>`;
      const embed = new EmbedBuilder()
        .setColor(0x4fc3f7)
        .setTitle('Nova semana')
        .setDescription(`Semana ${formatWeekRange(newWeekStart)}\n\nCapitão, lembre de cadastrar a disponibilidade do time. Pode cadastrar até 3 semanas adiantadas.`)
        .setFooter({ text: 'Use /disponibilidade no #agenda' });
      await chatChannel.send({ content: captainMention, embeds: [embed] }).catch(() => {});
    }
  }

  // Atualiza #disponibilidade público (3 semanas)
  await disponibilidade.updateAllDisponibilidadeChannel(guild)
    .catch(err => console.error('Erro #disponibilidade:', err));

  // Atualiza #times
  await updateTimesChannel(guild).catch(err => console.error('Erro #times:', err));
}

function startWeeklyCron(client) {
  // Toda segunda às 09:00 BRT
  cron.schedule('0 9 * * 1', async () => {
    try {
      console.log('[weekly] Iniciando virada de semana');
      await refreshWeek(client);
      console.log('[weekly] Virada de semana concluída');
    } catch (err) {
      console.error('Erro no cron semanal:', err);
    }
  }, { timezone: 'America/Sao_Paulo' });

  console.log('Cron semanal iniciado.');
}

module.exports = { startWeeklyCron, refreshWeek };
