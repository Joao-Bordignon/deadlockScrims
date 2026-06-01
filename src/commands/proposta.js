const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../database');
const disponibilidade = require('./disponibilidade');
const { updateAgendaChannel } = require('../utils/agenda');
const {
  HOUR_LABEL, HOUR_TIME, DAY_NAME, SHORT_DAY,
  getWeekStart, formatDate, getScheduledAt, sortDays, sortHours,
  isHourInPast,
} = require('../utils/time');

const sessions = new Map();
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;

function getExpiresAt(scheduledAt) {
  const timeUntil = scheduledAt.getTime() - Date.now();
  if (timeUntil >= TWO_HOURS_MS) return new Date(scheduledAt.getTime() - TWO_HOURS_MS);
  return new Date(scheduledAt.getTime() - THIRTY_MIN_MS);
}

async function getTeam(id) {
  const r = await db.query('SELECT * FROM teams WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function getCaptainTeam(userId) {
  const r = await db.query('SELECT * FROM teams WHERE captain_discord_id = $1', [userId]);
  return r.rows[0] || null;
}

async function startProposal(interaction, opponentTeamId) {
  const captainTeam = await getCaptainTeam(interaction.user.id);
  if (!captainTeam) {
    return interaction.reply({ content: 'Apenas capitães podem propor scrims.', flags: MessageFlags.Ephemeral });
  }
  if (captainTeam.suspended_until && new Date(captainTeam.suspended_until) > new Date()) {
    return interaction.reply({ content: `Seu time está suspenso. Motivo: ${captainTeam.suspension_reason || 'não informado'}.`, flags: MessageFlags.Ephemeral });
  }
  if (captainTeam.id === opponentTeamId) {
    return interaction.reply({ content: 'Você não pode propor scrim para o próprio time.', flags: MessageFlags.Ephemeral });
  }

  const opponent = await getTeam(opponentTeamId);
  if (!opponent) {
    return interaction.reply({ content: 'Time não encontrado.', flags: MessageFlags.Ephemeral });
  }
  if (opponent.suspended_until && new Date(opponent.suspended_until) > new Date()) {
    return interaction.reply({ content: 'Esse time está suspenso e não pode receber propostas.', flags: MessageFlags.Ephemeral });
  }

  const weekStart = getWeekStart();
  const avail = await db.query(
    `SELECT day_of_week, hour FROM availabilities
     WHERE team_id = $1 AND week_start = $2 AND is_blocked = false
     ORDER BY day_of_week, hour`,
    [opponentTeamId, weekStart]
  );

  if (avail.rows.length === 0) {
    return interaction.reply({ content: `${opponent.name} não tem horários disponíveis essa semana.`, flags: MessageFlags.Ephemeral });
  }

  const now = new Date();
  const slotsByDay = {};
  for (const row of avail.rows) {
    if (isHourInPast(weekStart, row.day_of_week, row.hour)) continue;
    const scheduledAt = getScheduledAt(weekStart, row.day_of_week, row.hour);
    // Mínimo de 30min entre agora e o início da scrim (senão o expires_at já estaria no passado)
    if (scheduledAt.getTime() - now.getTime() <= THIRTY_MIN_MS) continue;
    if (!slotsByDay[row.day_of_week]) slotsByDay[row.day_of_week] = [];
    slotsByDay[row.day_of_week].push(row.hour);
  }

  if (Object.keys(slotsByDay).length === 0) {
    return interaction.reply({ content: `${opponent.name} não tem horários futuros disponíveis no que resta dessa semana.`, flags: MessageFlags.Ephemeral });
  }

  sessions.set(interaction.user.id, {
    proposerTeam: captainTeam,
    opponentTeam: opponent,
    weekStart,
    slotsByDay,
    selectedDay: null,
  });
  setTimeout(() => sessions.delete(interaction.user.id), 10 * 60 * 1000);

  const days = sortDays(Object.keys(slotsByDay).map(Number));
  const dayButtons = days.map(d => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + (d === 0 ? 6 : d - 1));
    return new ButtonBuilder()
      .setCustomId(`proposta:day:${d}`)
      .setLabel(`${SHORT_DAY[d]} ${formatDate(date)}`)
      .setStyle(ButtonStyle.Secondary);
  });

  const rows = [];
  for (let i = 0; i < dayButtons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(dayButtons.slice(i, i + 5)));
  }

  const embed = new EmbedBuilder()
    .setColor(0x7c6af7)
    .setTitle(`Propor Scrim: ${opponent.name}`)
    .setDescription('Selecione o dia de preferência.');

  await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
}

async function handleDay(interaction, day) {
  const session = sessions.get(interaction.user.id);
  if (!session) {
    return interaction.reply({ content: 'Sessão expirada. Clique novamente em "Propor para [time]".', flags: MessageFlags.Ephemeral });
  }

  session.selectedDay = day;
  const hours = sortHours(session.slotsByDay[day]);
  const hourButtons = hours.map(h =>
    new ButtonBuilder()
      .setCustomId(`proposta:hour:${h}`)
      .setLabel(HOUR_LABEL(h))
      .setStyle(ButtonStyle.Secondary)
  );

  const rows = [];
  for (let i = 0; i < hourButtons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(hourButtons.slice(i, i + 5)));
  }

  const date = new Date(session.weekStart);
  date.setDate(date.getDate() + (day === 0 ? 6 : day - 1));

  const embed = new EmbedBuilder()
    .setColor(0x7c6af7)
    .setTitle(`Propor Scrim: ${session.opponentTeam.name}, ${SHORT_DAY[day]} ${formatDate(date)}`)
    .setDescription('Selecione o horário.');

  return interaction.update({ embeds: [embed], components: rows });
}

async function handleHour(interaction, hour) {
  const session = sessions.get(interaction.user.id);
  if (!session) {
    return interaction.reply({ content: 'Sessão expirada.', flags: MessageFlags.Ephemeral });
  }

  const day = session.selectedDay;
  const scheduledAt = getScheduledAt(session.weekStart, day, hour);
  const expiresAt = getExpiresAt(scheduledAt);

  // Mínimo de 30min até a scrim (impede expires_at no passado)
  if (scheduledAt.getTime() - Date.now() <= THIRTY_MIN_MS) {
    sessions.delete(interaction.user.id);
    return interaction.update({ content: 'Esse horário está muito próximo (menos de 30min). Não dá mais para propor.', embeds: [], components: [] });
  }

  // Verifica se o slot ainda está disponível
  const stillAvail = await db.query(
    `SELECT id FROM availabilities WHERE team_id = $1 AND week_start = $2 AND day_of_week = $3 AND hour = $4 AND is_blocked = false`,
    [session.opponentTeam.id, session.weekStart, day, hour]
  );
  if (stillAvail.rows.length === 0) {
    sessions.delete(interaction.user.id);
    return interaction.update({ content: 'Esse horário não está mais disponível.', embeds: [], components: [] });
  }

  // Cria a scrim
  const scrimResult = await db.query(
    `INSERT INTO scrims (team_home_id, team_away_id, scheduled_at, week_start, day_of_week, hour, status, proposed_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8) RETURNING id`,
    [session.proposerTeam.id, session.opponentTeam.id, scheduledAt, session.weekStart, day, hour, interaction.user.id, expiresAt]
  );
  const scrimId = scrimResult.rows[0].id;

  // Envia proposta no #propostas do adversário
  const propostasChannel = interaction.guild.channels.cache.get(session.opponentTeam.channel_propostas_id);
  let proposalMessage = null;
  if (propostasChannel) {
    const opponentRole = interaction.guild.roles.cache.get(session.opponentTeam.role_id);
    const expiresLabel = `${formatDate(expiresAt)} às ${HOUR_TIME(expiresAt.getHours())}`;

    const proposalEmbed = new EmbedBuilder()
      .setColor(0xffaa00)
      .setTitle('Proposta de Scrim recebida')
      .addFields(
        { name: 'Time adversário', value: session.proposerTeam.name, inline: true },
        { name: 'Proposto por', value: interaction.user.username, inline: true },
        { name: 'Data', value: `${DAY_NAME[day]} · ${formatDate(scheduledAt)}`, inline: false },
        { name: 'Horário', value: HOUR_TIME(hour), inline: false },
      )
      .setFooter({ text: `Proposta expira em: ${expiresLabel} (2h antes da scrim)` });

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`proposta:aceitar:${scrimId}`).setLabel('Aceitar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`proposta:recusar:${scrimId}`).setLabel('Recusar').setStyle(ButtonStyle.Danger),
    );

    const mention = opponentRole ? `<@&${opponentRole.id}>` : '';
    proposalMessage = await propostasChannel.send({
      content: `${mention} você recebeu uma proposta de scrim!`,
      embeds: [proposalEmbed],
      components: [buttonRow],
    });

    await db.query(
      'UPDATE scrims SET proposal_message_id = $1, proposal_channel_id = $2 WHERE id = $3',
      [proposalMessage.id, propostasChannel.id, scrimId]
    );
  }

  const expiresLabel = `${formatDate(expiresAt)} às ${HOUR_TIME(expiresAt.getHours())}`;
  const confirmEmbed = new EmbedBuilder()
    .setColor(0x4caf82)
    .setTitle('Proposta enviada!')
    .addFields(
      { name: 'Para', value: session.opponentTeam.name },
      { name: 'Data e hora', value: `${DAY_NAME[day]} ${formatDate(scheduledAt)} · ${HOUR_TIME(hour)}` },
    )
    .setFooter({ text: `Aguardando resposta · Expira ${expiresLabel}` });

  await interaction.update({ embeds: [confirmEmbed], components: [] });
  sessions.delete(interaction.user.id);
}

async function handleResposta(interaction, scrimId, aceitar) {
  const sR = await db.query('SELECT * FROM scrims WHERE id = $1', [scrimId]);
  if (sR.rows.length === 0) {
    return interaction.reply({ content: 'Proposta não encontrada.', flags: MessageFlags.Ephemeral });
  }
  const scrim = sR.rows[0];

  if (scrim.status !== 'pending') {
    const label = scrim.status === 'confirmed' ? 'aceita' : scrim.status === 'cancelled' ? 'recusada/cancelada' : 'expirada';
    return interaction.reply({ content: `Esta proposta já foi ${label}.`, flags: MessageFlags.Ephemeral });
  }

  const teams = await db.query('SELECT * FROM teams WHERE id IN ($1, $2)', [scrim.team_home_id, scrim.team_away_id]);
  const proposerTeam = teams.rows.find(t => t.id === scrim.team_home_id);
  const opponentTeam = teams.rows.find(t => t.id === scrim.team_away_id);

  if (opponentTeam.captain_discord_id !== interaction.user.id) {
    return interaction.reply({ content: 'Apenas o capitão do time pode responder a essa proposta.', flags: MessageFlags.Ephemeral });
  }

  if (aceitar) {
    await db.query("UPDATE scrims SET status = 'confirmed' WHERE id = $1", [scrimId]);
    // Bloqueia o horário nos dois times
    await db.query(
      `UPDATE availabilities SET is_blocked = true
       WHERE week_start = $1 AND day_of_week = $2 AND hour = $3 AND team_id IN ($4, $5)`,
      [scrim.week_start, scrim.day_of_week, scrim.hour, proposerTeam.id, opponentTeam.id]
    );

    const confirmedEmbed = new EmbedBuilder()
      .setColor(0x4caf82)
      .setTitle('Scrim confirmada!')
      .addFields(
        { name: 'Partida', value: `${proposerTeam.name} vs ${opponentTeam.name}` },
        { name: 'Data e hora', value: `${DAY_NAME[scrim.day_of_week]} ${formatDate(new Date(scrim.scheduled_at))} · ${HOUR_TIME(scrim.hour)}` },
      )
      .setFooter({ text: 'Horário bloqueado na agenda dos dois times' });

    await interaction.update({ embeds: [confirmedEmbed], components: [] });

    // Atualizações em background
    Promise.all([
      updateAgendaChannel(interaction.guild, proposerTeam, scrim.week_start),
      updateAgendaChannel(interaction.guild, opponentTeam, scrim.week_start),
      disponibilidade.updateDisponibilidadeChannel(interaction.guild, scrim.week_start),
      notifyProposer(interaction.guild, proposerTeam, opponentTeam, scrim, 'aceita'),
    ]).catch(err => console.error('Erro ao atualizar canais após aceite:', err));
  } else {
    await db.query("UPDATE scrims SET status = 'cancelled' WHERE id = $1", [scrimId]);

    const rejectedEmbed = new EmbedBuilder()
      .setColor(0xe05a5a)
      .setTitle('Proposta recusada')
      .addFields(
        { name: 'Partida', value: `${proposerTeam.name} vs ${opponentTeam.name}` },
        { name: 'Data e hora', value: `${DAY_NAME[scrim.day_of_week]} ${formatDate(new Date(scrim.scheduled_at))} · ${HOUR_TIME(scrim.hour)}` },
      );

    await interaction.update({ embeds: [rejectedEmbed], components: [] });

    notifyProposer(interaction.guild, proposerTeam, opponentTeam, scrim, 'recusada')
      .catch(err => console.error('Erro ao notificar proposer:', err));
  }
}

async function notifyProposer(guild, proposerTeam, opponentTeam, scrim, resultado) {
  const propostasChannel = guild.channels.cache.get(proposerTeam.channel_propostas_id);
  if (!propostasChannel) return;

  const cor = resultado === 'aceita' ? 0x4caf82 : 0xe05a5a;
  const titulo = resultado === 'aceita' ? 'Sua proposta foi aceita!' : 'Sua proposta foi recusada';

  const embed = new EmbedBuilder()
    .setColor(cor)
    .setTitle(titulo)
    .addFields(
      { name: 'Adversário', value: opponentTeam.name },
      { name: 'Data e hora', value: `${DAY_NAME[scrim.day_of_week]} ${formatDate(new Date(scrim.scheduled_at))} · ${HOUR_TIME(scrim.hour)}` },
    );

  await propostasChannel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = {
  name: 'proposta',
  startProposal,

  async handleComponent(interaction) {
    const parts = interaction.customId.split(':');
    const action = parts[1];

    if (action === 'propor') return startProposal(interaction, parseInt(parts[2]));
    if (action === 'day') return handleDay(interaction, parseInt(parts[2]));
    if (action === 'hour') return handleHour(interaction, parseInt(parts[2]));
    if (action === 'aceitar') return handleResposta(interaction, parseInt(parts[2]), true);
    if (action === 'recusar') return handleResposta(interaction, parseInt(parts[2]), false);
  },
};
