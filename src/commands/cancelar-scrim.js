const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const disponibilidade = require('./disponibilidade');
const { updateAgendaChannel } = require('../utils/agenda');
const { HOUR_TIME, DAY_NAME, formatDate } = require('../utils/time');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelar-scrim')
    .setDescription('Cancela uma scrim confirmada (mínimo 2h antes do horário)'),

  async execute(interaction) {
    const teamResult = await db.query('SELECT * FROM teams WHERE captain_discord_id = $1', [interaction.user.id]);
    if (teamResult.rows.length === 0) {
      return interaction.reply({ content: 'Apenas capitães podem cancelar scrims.', flags: MessageFlags.Ephemeral });
    }
    const team = teamResult.rows[0];

    const now = new Date();
    const cutoff = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const scrims = await db.query(
      `SELECT s.id, s.scheduled_at, s.day_of_week, s.hour, s.team_home_id, s.team_away_id,
              h.name AS home_name, a.name AS away_name
       FROM scrims s
       JOIN teams h ON h.id = s.team_home_id
       JOIN teams a ON a.id = s.team_away_id
       WHERE s.status = 'confirmed'
         AND s.scheduled_at > $1
         AND (s.team_home_id = $2 OR s.team_away_id = $2)
       ORDER BY s.scheduled_at`,
      [cutoff, team.id]
    );

    if (scrims.rows.length === 0) {
      return interaction.reply({ content: 'Nenhuma scrim disponível para cancelar (mínimo 2h de antecedência).', flags: MessageFlags.Ephemeral });
    }

    const options = scrims.rows.slice(0, 25).map(s => {
      const opponent = s.team_home_id === team.id ? s.away_name : s.home_name;
      return {
        label: `${opponent} · ${DAY_NAME[s.day_of_week]} ${formatDate(new Date(s.scheduled_at))} ${HOUR_TIME(s.hour)}`,
        value: String(s.id),
      };
    });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('cancelar-scrim:select')
      .setPlaceholder('Selecione a scrim para cancelar')
      .addOptions(options);

    await interaction.reply({
      content: 'Qual scrim deseja cancelar?',
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
  },

  async handleComponent(interaction) {
    if (interaction.customId !== 'cancelar-scrim:select') return;

    const scrimId = parseInt(interaction.values[0]);
    const sR = await db.query('SELECT * FROM scrims WHERE id = $1', [scrimId]);
    if (sR.rows.length === 0) {
      return interaction.update({ content: 'Scrim não encontrada.', components: [] });
    }
    const scrim = sR.rows[0];

    const now = new Date();
    const cutoff = new Date(scrim.scheduled_at).getTime() - 2 * 60 * 60 * 1000;
    if (now.getTime() > cutoff) {
      return interaction.update({ content: 'Esta scrim não pode mais ser cancelada (faltam menos de 2h).', components: [] });
    }

    const teams = await db.query('SELECT * FROM teams WHERE id IN ($1, $2)', [scrim.team_home_id, scrim.team_away_id]);
    const homeTeam = teams.rows.find(t => t.id === scrim.team_home_id);
    const awayTeam = teams.rows.find(t => t.id === scrim.team_away_id);

    if (homeTeam.captain_discord_id !== interaction.user.id && awayTeam.captain_discord_id !== interaction.user.id) {
      return interaction.update({ content: 'Apenas capitães dos times envolvidos podem cancelar.', components: [] });
    }

    await db.query("UPDATE scrims SET status = 'cancelled' WHERE id = $1", [scrimId]);
    await db.query(
      `UPDATE availabilities SET is_blocked = false
       WHERE week_start = $1 AND day_of_week = $2 AND hour = $3 AND team_id IN ($4, $5)`,
      [scrim.week_start, scrim.day_of_week, scrim.hour, homeTeam.id, awayTeam.id]
    );

    const embed = new EmbedBuilder()
      .setColor(0xe05a5a)
      .setTitle('Scrim cancelada')
      .addFields(
        { name: 'Partida', value: `${homeTeam.name} vs ${awayTeam.name}` },
        { name: 'Data e hora', value: `${DAY_NAME[scrim.day_of_week]} ${formatDate(new Date(scrim.scheduled_at))} · ${HOUR_TIME(scrim.hour)}` },
      )
      .setFooter({ text: 'Horário voltou a ficar disponível para os dois times' });

    await interaction.update({ content: '', embeds: [embed], components: [] });

    Promise.all([
      updateAgendaChannel(interaction.guild, homeTeam, scrim.week_start),
      updateAgendaChannel(interaction.guild, awayTeam, scrim.week_start),
      disponibilidade.updateDisponibilidadeChannel(interaction.guild, scrim.week_start),
      notifyCancellation(interaction.guild, homeTeam, awayTeam, scrim, interaction.user.username),
    ]).catch(err => console.error('Erro nas atualizações pós-cancelamento:', err));
  },
};

async function notifyCancellation(guild, homeTeam, awayTeam, scrim, cancelledBy) {
  for (const team of [homeTeam, awayTeam]) {
    const propostas = guild.channels.cache.get(team.channel_propostas_id);
    if (!propostas) continue;
    const opponent = team.id === homeTeam.id ? awayTeam.name : homeTeam.name;
    const embed = new EmbedBuilder()
      .setColor(0xe05a5a)
      .setTitle('Scrim cancelada')
      .addFields(
        { name: 'Adversário', value: opponent },
        { name: 'Data e hora', value: `${DAY_NAME[scrim.day_of_week]} ${formatDate(new Date(scrim.scheduled_at))} · ${HOUR_TIME(scrim.hour)}` },
      )
      .setFooter({ text: `Cancelada por ${cancelledBy}` });
    await propostas.send({ embeds: [embed] }).catch(() => {});
  }
}
