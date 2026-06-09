const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const disponibilidade = require('./disponibilidade');
const { updateAgendaChannel } = require('../utils/agenda');
const { HOUR_TIME, DAY_NAME, formatDate } = require('../utils/time');
const { getCaptainTeam, captainMention } = require('../utils/captain');

const HOUR_MS = 60 * 60 * 1000;
const TIER_72H = 72 * HOUR_MS;
const TIER_24H = 24 * HOUR_MS;
const TIER_6H = 6 * HOUR_MS;
const THIRTY_MIN = 30 * 60 * 1000;

// Regra escalonada de cancelamento
function getCancellationDeadline(scrim) {
  const confirmedAt = new Date(scrim.confirmed_at || scrim.created_at);
  const scheduledAt = new Date(scrim.scheduled_at);
  const leadTimeMs = scheduledAt.getTime() - confirmedAt.getTime();

  let deadlineBefore;
  if (leadTimeMs >= TIER_72H) {
    deadlineBefore = 48 * HOUR_MS;
  } else if (leadTimeMs >= TIER_24H) {
    deadlineBefore = 12 * HOUR_MS;
  } else if (leadTimeMs >= TIER_6H) {
    deadlineBefore = 5 * HOUR_MS;
  } else {
    deadlineBefore = Math.max(leadTimeMs / 2, THIRTY_MIN);
  }

  return new Date(scheduledAt.getTime() - deadlineBefore);
}

function formatLeadTime(ms) {
  const hours = Math.floor(ms / HOUR_MS);
  if (hours >= 24) return `${Math.floor(hours / 24)} dia${Math.floor(hours / 24) === 1 ? '' : 's'}`;
  if (hours >= 1) return `${hours}h`;
  return `${Math.floor(ms / (60 * 1000))}min`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelar-scrim')
    .setDescription('Cancela uma scrim confirmada (prazo varia conforme antecedência)'),

  async execute(interaction) {
    const team = await getCaptainTeam(interaction.member);
    if (!team) {
      return interaction.reply({ content: 'Apenas capitães podem cancelar scrims.', flags: MessageFlags.Ephemeral });
    }

    const scrims = await db.query(
      `SELECT s.id, s.scheduled_at, s.confirmed_at, s.created_at, s.day_of_week, s.hour,
              s.team_home_id, s.team_away_id,
              h.name AS home_name, a.name AS away_name
       FROM scrims s
       JOIN teams h ON h.id = s.team_home_id
       JOIN teams a ON a.id = s.team_away_id
       WHERE s.status = 'confirmed'
         AND s.scheduled_at > NOW()
         AND (s.team_home_id = $1 OR s.team_away_id = $1)
       ORDER BY s.scheduled_at`,
      [team.id]
    );

    const now = new Date();
    const cancelable = scrims.rows.filter(s => getCancellationDeadline(s) > now);

    if (cancelable.length === 0) {
      return interaction.reply({ content: 'Nenhuma scrim disponível pra cancelar (prazo de cancelamento já passou em todas as suas scrims futuras).', flags: MessageFlags.Ephemeral });
    }

    const options = cancelable.slice(0, 25).map(s => {
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
    const deadline = getCancellationDeadline(scrim);
    if (now > deadline) {
      const confirmedAt = new Date(scrim.confirmed_at || scrim.created_at);
      const leadMs = new Date(scrim.scheduled_at).getTime() - confirmedAt.getTime();
      return interaction.update({
        content: `Essa scrim não pode mais ser cancelada. Foi marcada com ${formatLeadTime(leadMs)} de antecedência e o prazo de cancelamento já passou.`,
        components: [],
      });
    }

    const teams = await db.query('SELECT * FROM teams WHERE id IN ($1, $2)', [scrim.team_home_id, scrim.team_away_id]);
    const homeTeam = teams.rows.find(t => t.id === scrim.team_home_id);
    const awayTeam = teams.rows.find(t => t.id === scrim.team_away_id);

    const userTeam = await getCaptainTeam(interaction.member);
    if (!userTeam || (userTeam.id !== homeTeam.id && userTeam.id !== awayTeam.id)) {
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
      disponibilidade.updateAllDisponibilidadeChannel(interaction.guild),
      disponibilidade.postAllAvailabilityToAgenda(interaction.guild, homeTeam),
      disponibilidade.postAllAvailabilityToAgenda(interaction.guild, awayTeam),
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
        { name: 'Adversário', value: opponent, inline: true },
        { name: 'Cancelada por', value: cancelledBy, inline: true },
        { name: 'Data e hora', value: `${DAY_NAME[scrim.day_of_week]} ${formatDate(new Date(scrim.scheduled_at))} · ${HOUR_TIME(scrim.hour)}` },
      );
    await propostas.send({ content: captainMention(guild), embeds: [embed] }).catch(() => {});
  }
}
