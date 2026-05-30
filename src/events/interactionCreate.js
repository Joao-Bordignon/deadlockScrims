module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        const msg = { content: 'Erro ao executar o comando.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg);
        } else {
          await interaction.reply(msg);
        }
      }
    }

    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      // Handlers de botões são roteados pelo customId
      const [commandName] = interaction.customId.split(':');
      const command = client.commands.get(commandName);
      if (!command?.handleComponent) return;

      try {
        await command.handleComponent(interaction);
      } catch (error) {
        console.error(error);
      }
    }
  },
};
