const cron = require('node-cron');
const disponibilidade = require('../commands/disponibilidade');
const { updateTimesChannel } = require('../utils/times');

async function refreshAll(client) {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);

  await disponibilidade.updateAllDisponibilidadeChannel(guild)
    .catch(err => console.error('[daily] erro #disponibilidade:', err));

  await updateTimesChannel(guild)
    .catch(err => console.error('[daily] erro #times:', err));
}

function startDailyCron(client) {
  // Todo dia às 08:00 BRT (silencioso, sem ping)
  cron.schedule('0 8 * * *', async () => {
    try {
      console.log('[daily] Refresh diário iniciado');
      await refreshAll(client);
      console.log('[daily] Refresh diário concluído');
    } catch (err) {
      console.error('Erro no cron diário:', err);
    }
  }, { timezone: 'America/Sao_Paulo' });

  console.log('Cron diário iniciado.');
}

module.exports = { startDailyCron, refreshAll };
