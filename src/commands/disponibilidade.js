const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../database');
const {
  isDayInPast, isHourInPast,
  getWeekStartOffset, getActiveWeekStarts, weekLabel,
  formatWeekRange,
} = require('../utils/time');
const { getCaptainTeam } = require('../utils/captain');

const sessions = new Map();

const DAYS = [
  { label: 'Segunda', value: 1 },
  { label: 'Terça',   value: 2 },
  { label: 'Quarta',  value: 3 },
  { label: 'Quinta',  value: 4 },
  { label: 'Sexta',   value: 5 },
  { label: 'Sábado',  value: 6 },
  { label: 'Domingo', value: 0 },
];

const HOURS = [18, 19, 20, 21, 22, 23, 0];
const HOUR_LABEL = h => h === 0 ? '00h' : `${h}h`;
const DAY_NAME = { 0: 'Domingo', 1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira', 4: 'Quinta-feira', 5: 'Sexta-feira', 6: 'Sábado' };

function sortDays(days) {
  return [...days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
}

function sortHours(hours) {
  return [...hours].sort((a, b) => (a === 0 ? 24 : a) - (b === 0 ? 24 : b));
}

function dayButton(d, selectedDays, weekStart, lockedHours) {
  const past = isDayInPast(weekStart, d.value);
  const hasLock = (lockedHours?.[d.value] || []).length > 0;
  return new ButtonBuilder()
    .setCustomId(`disponibilidade:day:${d.value}`)
    .setLabel(selectedDays.includes(d.value) ? `${d.label} ✓` : d.label)
    .setStyle(selectedDays.includes(d.value) ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setDisabled(past || hasLock);
}

function buildDayRows(selectedDays, hasExisting, weekStart, lockedHours = {}) {
  const row1 = new ActionRowBuilder().addComponents(
    DAYS.slice(0, 5).map(d => dayButton(d, selectedDays, weekStart, lockedHours))
  );
  const row2 = new ActionRowBuilder().addComponents([
    ...DAYS.slice(5).map(d => dayButton(d, selectedDays, weekStart, lockedHours)),
    new ButtonBuilder()
      .setCustomId('disponibilidade:days_next')
      .setLabel('Próximo →')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(selectedDays.length === 0),
  ]);
  const rows = [row1, row2];
  if (hasExisting) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('disponibilidade:clear')
        .setLabel('Limpar tudo')
        .setStyle(ButtonStyle.Danger)
    ));
  }
  return rows;
}

function hourButton(h, selectedHours, weekStart, day, lockedForDay = []) {
  const past = isHourInPast(weekStart, day, h);
  const locked = lockedForDay.includes(h);
  let label = HOUR_LABEL(h);
  if (locked) label = `${HOUR_LABEL(h)} ⚔️`;
  else if (selectedHours.includes(h)) label = `${HOUR_LABEL(h)} ✓`;
  return new ButtonBuilder()
    .setCustomId(`disponibilidade:hour:${h}`)
    .setLabel(label)
    .setStyle(selectedHours.includes(h) || locked ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setDisabled(past || locked);
}

function buildHourRows(selectedHours, isLast, weekStart, day, lockedForDay = []) {
  const row1 = new ActionRowBuilder().addComponents(
    HOURS.slice(0, 5).map(h => hourButton(h, selectedHours, weekStart, day, lockedForDay))
  );
  const row2 = new ActionRowBuilder().addComponents([
    ...HOURS.slice(5).map(h => hourButton(h, selectedHours, weekStart, day, lockedForDay)),
    new ButtonBuilder()
      .setCustomId('disponibilidade:hours_next')
      .setLabel(isLast ? 'Confirmar ✓' : 'Próximo →')
      .setStyle(isLast ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(selectedHours.length === 0),
  ]);
  return [row1, row2];
}

function buildWeekRows() {
  const buttons = [0, 1, 2].map(offset => {
    const ws = getWeekStartOffset(offset);
    return new ButtonBuilder()
      .setCustomId(`disponibilidade:week:${offset}`)
      .setLabel(`${weekLabel(offset)} (${formatWeekRange(ws)})`)
      .setStyle(ButtonStyle.Primary);
  });
  return [new ActionRowBuilder().addComponents(buttons)];
}

async function loadExistingAvailability(teamId, weekStart) {
  const result = await db.query(
    'SELECT day_of_week, hour, is_blocked FROM availabilities WHERE team_id = $1 AND week_start = $2',
    [teamId, weekStart]
  );
  const dayHours = {};
  const lockedHours = {};
  for (const row of result.rows) {
    if (isHourInPast(weekStart, row.day_of_week, row.hour)) continue;
    if (!dayHours[row.day_of_week]) dayHours[row.day_of_week] = [];
    dayHours[row.day_of_week].push(row.hour);
    if (row.is_blocked) {
      if (!lockedHours[row.day_of_week]) lockedHours[row.day_of_week] = [];
      lockedHours[row.day_of_week].push(row.hour);
    }
  }
  for (const day of Object.keys(dayHours)) dayHours[day] = sortHours(dayHours[day]);
  for (const day of Object.keys(lockedHours)) lockedHours[day] = sortHours(lockedHours[day]);
  const selectedDays = sortDays(Object.keys(dayHours).map(Number));
  return { selectedDays, dayHours, lockedHours };
}

function buildAvailabilityEmbedForWeek(team, weekStart, weeksAhead, data) {
  const { selectedDays, dayHours, lockedHours } = data;
  const lines = selectedDays.length === 0
    ? ['Nenhum horário cadastrado.']
    : selectedDays.map(d => {
        const locked = lockedHours?.[d] || [];
        const hourStrs = dayHours[d].map(h => locked.includes(h) ? `~~${HOUR_LABEL(h)}~~` : HOUR_LABEL(h));
        return `${DAY_NAME[d]}: ${hourStrs.join(' · ')}`;
      });

  return new EmbedBuilder()
    .setColor(0x4caf82)
    .setTitle(`Disponibilidade: ${team.name} (${weekLabel(weeksAhead)})`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Semana ${formatWeekRange(weekStart)}` });
}

async function postAllAvailabilityToAgenda(guild, team) {
  const agendaChannel = guild.channels.cache.get(team.channel_agenda_id);
  if (!agendaChannel) return;

  // Remove todos os posts antigos de disponibilidade
  const msgs = await agendaChannel.messages.fetch({ limit: 30 }).catch(() => null);
  if (msgs) {
    for (const msg of msgs.filter(m => m.author.bot && m.embeds[0]?.title?.startsWith('Disponibilidade:')).values()) {
      await msg.delete().catch(() => {});
    }
  }

  // Posta as 3 semanas em ordem
  for (let offset = 0; offset < 3; offset++) {
    const ws = getWeekStartOffset(offset);
    const data = await loadExistingAvailability(team.id, ws);
    const embed = buildAvailabilityEmbedForWeek(team, ws, offset, data);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`disponibilidade:editar:${team.id}:${offset}`)
        .setLabel('Editar disponibilidade')
        .setStyle(ButtonStyle.Primary)
    );
    await agendaChannel.send({ embeds: [embed], components: [row] });
  }
}

async function buildDisponibilidadeWeekEmbed(guild, weekStart, weeksAhead) {
  const result = await db.query(`
    SELECT t.id, t.name, a.day_of_week, a.hour, a.is_blocked
    FROM teams t
    JOIN availabilities a ON a.team_id = t.id
    WHERE a.week_start = $1
      AND (t.suspended_until IS NULL OR t.suspended_until < NOW())
    ORDER BY t.name, a.day_of_week, a.hour
  `, [weekStart]);

  const teamsMap = {};
  for (const row of result.rows) {
    if (isHourInPast(weekStart, row.day_of_week, row.hour)) continue;
    if (!teamsMap[row.id]) teamsMap[row.id] = { name: row.name, days: {} };
    if (!teamsMap[row.id].days[row.day_of_week]) teamsMap[row.id].days[row.day_of_week] = [];
    teamsMap[row.id].days[row.day_of_week].push({ hour: row.hour, blocked: row.is_blocked });
  }

  const teamEntries = Object.entries(teamsMap);
  const embed = new EmbedBuilder()
    .setColor(0x4fc3f7)
    .setTitle(`Times disponíveis: ${weekLabel(weeksAhead)}`)
    .setFooter({ text: formatWeekRange(weekStart) });

  if (teamEntries.length === 0) {
    embed.setDescription('Nenhum time tem horários futuros nesta semana.');
    return { embed, buttonRows: [] };
  }

  for (const [, team] of teamEntries) {
    const lines = [];
    const orderedDays = sortDays(Object.keys(team.days).map(Number));
    for (const day of orderedDays) {
      const hours = team.days[day];
      const hoursStr = hours.map(h => h.blocked ? `~~${HOUR_LABEL(h.hour)}~~` : HOUR_LABEL(h.hour)).join(' · ');
      lines.push(`${DAY_NAME[day]}: ${hoursStr}`);
    }
    embed.addFields({ name: team.name, value: lines.join('\n') });
  }

  const buttonRows = [];
  for (let i = 0; i < teamEntries.length && i < 25; i += 5) {
    const row = new ActionRowBuilder().addComponents(
      teamEntries.slice(i, i + 5).map(([id, t]) =>
        new ButtonBuilder()
          .setCustomId(`proposta:propor:${id}:${weeksAhead}`)
          .setLabel(`Propor para ${t.name}`)
          .setStyle(ButtonStyle.Primary)
      )
    );
    buttonRows.push(row);
  }

  return { embed, buttonRows };
}

async function updateAllDisponibilidadeChannel(guild) {
  const dispChannel = guild.channels.cache.find(c => c.name.startsWith('disponibilidade'));
  if (!dispChannel) return;

  // Apaga mensagens anteriores do bot
  const msgs = await dispChannel.messages.fetch({ limit: 30 }).catch(() => null);
  if (msgs) {
    for (const msg of msgs.filter(m => m.author.bot).values()) {
      await msg.delete().catch(() => {});
    }
  }

  // Posta uma mensagem por semana
  for (let offset = 0; offset < 3; offset++) {
    const ws = getWeekStartOffset(offset);
    const { embed, buttonRows } = await buildDisponibilidadeWeekEmbed(guild, ws, offset);
    await dispChannel.send({ embeds: [embed], components: buttonRows });
  }
}

async function startFlow(interaction, team, isEdit, weekStart = null, weeksAhead = null) {
  // Se weekStart não foi fornecido, pede seleção de semana primeiro
  if (!weekStart) {
    sessions.set(interaction.user.id, {
      teamId: team.id,
      teamName: team.name,
      team,
      step: 'week',
    });
    setTimeout(() => sessions.delete(interaction.user.id), 10 * 60 * 1000);

    const embed = new EmbedBuilder()
      .setColor(0x4fc3f7)
      .setTitle('Selecione a semana')
      .setDescription('Escolha qual semana você quer cadastrar ou editar.')
      .setFooter({ text: 'Você pode cadastrar até 3 semanas adiantadas.' });

    return interaction.reply({
      embeds: [embed],
      components: buildWeekRows(),
      flags: MessageFlags.Ephemeral,
    });
  }

  // Já tem weekStart: vai direto pra seleção de dias
  const existing = await loadExistingAvailability(team.id, weekStart);

  sessions.set(interaction.user.id, {
    teamId: team.id,
    teamName: team.name,
    team,
    weekStart,
    weeksAhead,
    selectedDays: existing.selectedDays,
    dayHours: existing.dayHours,
    lockedHours: existing.lockedHours,
    currentDayIndex: 0,
    step: 'days',
    hasExisting: existing.selectedDays.length > 0,
  });

  setTimeout(() => sessions.delete(interaction.user.id), 10 * 60 * 1000);

  const selected = existing.selectedDays.map(d => DAYS.find(x => x.value === d).label).join(', ');
  const embed = new EmbedBuilder()
    .setColor(0x4fc3f7)
    .setTitle(`Passo 1 de 2: Selecione os dias disponíveis${isEdit ? ' (editando)' : ''}`)
    .setDescription(`${weekLabel(weeksAhead)} (${formatWeekRange(weekStart)})${selected ? `\nSelecionados: ${selected}` : ''}`)
    .setFooter({ text: 'Clique nos dias para selecionar. Clique novamente para desmarcar.' });

  const components = buildDayRows(existing.selectedDays, existing.selectedDays.length > 0, weekStart, existing.lockedHours);

  if (interaction.replied || interaction.deferred) {
    return interaction.editReply({ embeds: [embed], components });
  }
  return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disponibilidade')
    .setDescription('Cadastra os horários disponíveis do time para as próximas 3 semanas'),

  postAllAvailabilityToAgenda,
  updateAllDisponibilidadeChannel,
  loadExistingAvailability,

  async execute(interaction) {
    const team = await getCaptainTeam(interaction.member);
    if (!team) {
      return interaction.reply({ content: 'Apenas capitães podem cadastrar a disponibilidade. Se você é capitão, verifique se tem o cargo do time e o cargo `Capitão`.', flags: MessageFlags.Ephemeral });
    }
    if (team.suspended_until && new Date(team.suspended_until) > new Date()) {
      return interaction.reply({ content: `Seu time está suspenso. Motivo: ${team.suspension_reason || 'não informado'}.`, flags: MessageFlags.Ephemeral });
    }

    await startFlow(interaction, team, false);
  },

  async handleComponent(interaction) {
    const parts = interaction.customId.split(':');
    const action = parts[1];

    if (action === 'editar') {
      const teamId = parseInt(parts[2]);
      const weeksAhead = parseInt(parts[3] || '0');
      const teamResult = await db.query('SELECT * FROM teams WHERE id = $1', [teamId]);
      if (teamResult.rows.length === 0) {
        return interaction.reply({ content: 'Time não encontrado.', flags: MessageFlags.Ephemeral });
      }
      const team = teamResult.rows[0];
      const userTeam = await getCaptainTeam(interaction.member);
      if (!userTeam || userTeam.id !== team.id) {
        return interaction.reply({ content: 'Apenas capitães deste time podem editar a disponibilidade.', flags: MessageFlags.Ephemeral });
      }
      const weekStart = getWeekStartOffset(weeksAhead);
      return startFlow(interaction, team, true, weekStart, weeksAhead);
    }

    const session = sessions.get(interaction.user.id);
    if (!session) {
      return interaction.reply({ content: 'Sessão expirada. Use /disponibilidade novamente.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'week') {
      const weeksAhead = parseInt(parts[2]);
      const weekStart = getWeekStartOffset(weeksAhead);
      const existing = await loadExistingAvailability(session.teamId, weekStart);

      session.weekStart = weekStart;
      session.weeksAhead = weeksAhead;
      session.selectedDays = existing.selectedDays;
      session.dayHours = existing.dayHours;
      session.lockedHours = existing.lockedHours;
      session.currentDayIndex = 0;
      session.step = 'days';
      session.hasExisting = existing.selectedDays.length > 0;

      const selected = existing.selectedDays.map(d => DAYS.find(x => x.value === d).label).join(', ');
      const embed = new EmbedBuilder()
        .setColor(0x4fc3f7)
        .setTitle('Passo 1 de 2: Selecione os dias disponíveis')
        .setDescription(`${weekLabel(weeksAhead)} (${formatWeekRange(weekStart)})${selected ? `\nSelecionados: ${selected}` : ''}`)
        .setFooter({ text: 'Clique nos dias para selecionar. Clique novamente para desmarcar.' });

      return interaction.update({
        embeds: [embed],
        components: buildDayRows(existing.selectedDays, existing.selectedDays.length > 0, weekStart, existing.lockedHours),
      });
    }

    if (action === 'day') {
      const dayValue = parseInt(parts[2]);
      if (session.selectedDays.includes(dayValue)) {
        session.selectedDays = session.selectedDays.filter(d => d !== dayValue);
        delete session.dayHours[dayValue];
      } else {
        session.selectedDays = sortDays([...session.selectedDays, dayValue]);
      }

      const selected = session.selectedDays.map(d => DAYS.find(x => x.value === d).label).join(', ');
      const embed = new EmbedBuilder()
        .setColor(0x4fc3f7)
        .setTitle('Passo 1 de 2: Selecione os dias disponíveis')
        .setDescription(`${weekLabel(session.weeksAhead)} (${formatWeekRange(session.weekStart)})${selected ? `\nSelecionados: ${selected}` : ''}`)
        .setFooter({ text: 'Clique nos dias para selecionar. Clique novamente para desmarcar.' });

      return interaction.update({
        embeds: [embed],
        components: buildDayRows(session.selectedDays, session.hasExisting, session.weekStart, session.lockedHours),
      });
    }

    if (action === 'clear') {
      const weekStart = session.weekStart;
      await db.query('DELETE FROM availabilities WHERE team_id = $1 AND week_start = $2 AND is_blocked = false', [session.teamId, weekStart]);

      const clearedEmbed = new EmbedBuilder()
        .setColor(0xe05a5a)
        .setTitle(`Disponibilidade removida: ${session.teamName}`)
        .setDescription(`Todos os dias e horários da ${weekLabel(session.weeksAhead).toLowerCase()} foram removidos.`)
        .setFooter({ text: `Semana ${formatWeekRange(weekStart)}` });

      await interaction.update({ embeds: [clearedEmbed], components: [] });

      Promise.all([
        postAllAvailabilityToAgenda(interaction.guild, session.team),
        updateAllDisponibilidadeChannel(interaction.guild),
      ]).catch(err => console.error('Erro ao atualizar canais:', err));

      sessions.delete(interaction.user.id);
      return;
    }

    if (action === 'days_next') {
      session.step = 'hours';
      session.currentDayIndex = 0;

      const currentDay = session.selectedDays[0];
      const isLast = session.selectedDays.length === 1;
      const preLoaded = session.dayHours[currentDay] || [];

      const embed = new EmbedBuilder()
        .setColor(0x4fc3f7)
        .setTitle(`${DAY_NAME[currentDay]}: Selecione os horários (1 de ${session.selectedDays.length})`)
        .setDescription(preLoaded.length > 0 ? `Selecionados: ${preLoaded.map(HOUR_LABEL).join(' · ')}` : 'Clique nos horários para selecionar.')
        .setFooter({ text: 'Clique novamente para desmarcar.' });

      return interaction.update({ embeds: [embed], components: buildHourRows(preLoaded, isLast, session.weekStart, currentDay, session.lockedHours?.[currentDay] || []) });
    }

    if (action === 'hour') {
      const hour = parseInt(parts[2]);
      const currentDay = session.selectedDays[session.currentDayIndex];
      if (!session.dayHours[currentDay]) session.dayHours[currentDay] = [];

      if (session.dayHours[currentDay].includes(hour)) {
        session.dayHours[currentDay] = session.dayHours[currentDay].filter(h => h !== hour);
      } else {
        session.dayHours[currentDay] = sortHours([...session.dayHours[currentDay], hour]);
      }

      const isLast = session.currentDayIndex === session.selectedDays.length - 1;
      const selected = session.dayHours[currentDay];

      const embed = new EmbedBuilder()
        .setColor(0x4fc3f7)
        .setTitle(`${DAY_NAME[currentDay]}: Selecione os horários (${session.currentDayIndex + 1} de ${session.selectedDays.length})`)
        .setDescription(selected.length > 0 ? `Selecionados: ${selected.map(HOUR_LABEL).join(' · ')}` : 'Clique nos horários para selecionar.')
        .setFooter({ text: 'Clique novamente para desmarcar.' });

      return interaction.update({ embeds: [embed], components: buildHourRows(selected, isLast, session.weekStart, currentDay, session.lockedHours?.[currentDay] || []) });
    }

    if (action === 'hours_next') {
      const isLast = session.currentDayIndex === session.selectedDays.length - 1;

      if (isLast) {
        const weekStart = session.weekStart;

        await db.query('DELETE FROM availabilities WHERE team_id = $1 AND week_start = $2 AND is_blocked = false', [session.teamId, weekStart]);

        const values = [];
        const params = [];
        let paramIdx = 1;
        for (const day of session.selectedDays) {
          const hours = session.dayHours[day] || [];
          const lockedForDay = session.lockedHours?.[day] || [];
          for (const hour of hours) {
            if (lockedForDay.includes(hour)) continue;
            values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
            params.push(session.teamId, weekStart, day, hour);
          }
        }
        if (values.length > 0) {
          await db.query(
            `INSERT INTO availabilities (team_id, week_start, day_of_week, hour) VALUES ${values.join(', ')}`,
            params
          );
        }

        const lines = session.selectedDays
          .filter(d => session.dayHours[d]?.length > 0)
          .map(d => `${DAY_NAME[d]}: ${session.dayHours[d].map(HOUR_LABEL).join(' · ')}`);

        const confirmEmbed = new EmbedBuilder()
          .setColor(0x4caf82)
          .setTitle(`Disponibilidade salva: ${session.teamName}`)
          .setDescription(`${weekLabel(session.weeksAhead)} (${formatWeekRange(weekStart)})\n\n${lines.length > 0 ? lines.join('\n') : 'Nenhum horário cadastrado.'}`)
          .setFooter({ text: 'Use /disponibilidade novamente para cadastrar outra semana.' });

        await interaction.update({ embeds: [confirmEmbed], components: [] });

        Promise.all([
          postAllAvailabilityToAgenda(interaction.guild, session.team),
          updateAllDisponibilidadeChannel(interaction.guild),
        ]).catch(err => console.error('Erro ao atualizar canais:', err));

        sessions.delete(interaction.user.id);
      } else {
        session.currentDayIndex++;
        const nextDay = session.selectedDays[session.currentDayIndex];
        const nextIsLast = session.currentDayIndex === session.selectedDays.length - 1;
        const preLoaded = session.dayHours[nextDay] || [];

        const embed = new EmbedBuilder()
          .setColor(0x4fc3f7)
          .setTitle(`${DAY_NAME[nextDay]}: Selecione os horários (${session.currentDayIndex + 1} de ${session.selectedDays.length})`)
          .setDescription(preLoaded.length > 0 ? `Selecionados: ${preLoaded.map(HOUR_LABEL).join(' · ')}` : 'Clique nos horários para selecionar.')
          .setFooter({ text: 'Clique novamente para desmarcar.' });

        return interaction.update({ embeds: [embed], components: buildHourRows(preLoaded, nextIsLast, session.weekStart, nextDay, session.lockedHours?.[nextDay] || []) });
      }
    }
  },
};
