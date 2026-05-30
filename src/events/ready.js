const { startExpirationCron } = require('../cron/expirations');
const { startReminderCron } = require('../cron/reminders');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`Bot online: ${client.user.tag}`);
    startExpirationCron(client);
    startReminderCron(client);
  },
};
