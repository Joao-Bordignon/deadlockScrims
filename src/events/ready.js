const { startExpirationCron } = require('../cron/expirations');
const { startReminderCron } = require('../cron/reminders');
const { startWeeklyCron } = require('../cron/weekly');
const { startDailyCron } = require('../cron/daily');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`Bot online: ${client.user.tag}`);
    startExpirationCron(client);
    startReminderCron(client);
    startWeeklyCron(client);
    startDailyCron(client);
  },
};
