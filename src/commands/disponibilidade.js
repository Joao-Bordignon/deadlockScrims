const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../database');
const { isDayInPast, isHourInPast } = require('../utils/time');

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

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatWeekRange(weekStart) {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const fmt = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(weekStart)} a ${fmt(end)}`;
}

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

async function postAvailabilityToAgenda(guild, team, weekStart) {
  const agendaChannel = guild.channels.cache.get(team.channel_agenda_id);
  if (!agendaChannel) return;

  const { selectedDays, dayHours } = await loadExistingAvailability(team.id, weekStart);

  // Remove o post anterior de disponibilidade (se existir)
  const msgs = await agendaChannel.messages.fetch({ limit: 20 }).catch(() => null);
  if (msgs) {
    for (const msg of msgs.filter(m => m.author.bot && m.embeds[0]?.title?.startsWith('Disponibilidade')).values()) {
      await msg.delete().catch(() => {});
    }
  }

  const lines = selectedDays.length === 0
    ? ['Nenhum horário cadastrado.']
    : selectedDays.map(d => `${DAY_NAME[d]}: ${dayHours[d].map(HOUR_LABEL).join(' · ')}`);

  const embed = new EmbedBuilder()
    .setColor(0x4caf82)
    .setTitle(`Disponibilidade: ${team.name}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Semana ${formatWeekRange(weekStart)}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`disponibilidade:editar:${team.id}`)
      .setLabel('Editar disponibilidade')
      .setStyle(ButtonStyle.Primary)
  );

  await agendaChannel.send({ embeds: [embed], components: [row] });
}

async function updateDisponibilidadeChannel(guild, weekStart) {
  const dispChannel = guild.channels.cache.find(c => c.name.startsWith('disponibilidade'));
  if (!dispChannel) return;

  const result = await db.query(`
    SELECT t.id, t.name, a.day_of_week, a.hour, a.is_blocked
    FROM teams t
    JOIN availabilities a ON a.team_id = t.id
    WHERE a.week_start = $1
      AND (t.suspended_until IS NULL OR t.suspended_until < NOW())
    ORDER BY t.name, a.day_of_week, a.hour
  `, [weekStart]);

  const msgs = await dispChannel.messages.fetch({ limit: 20 });
  for (const msg of msgs.filter(m => m.author.bot).values()) {
    await msg.delete().catch(() => {});
  }

  if (result.rows.length === 0) {
    await dispChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x4fc3f7)
          .setTitle('Times disponíveis esta semana')
          .setDescription('Nenhum time cadastrou disponibilidade ainda.')
          .setFooter({ text: formatWeekRange(weekStart) }),
      ],
    });
    return;
  }

  const teamsMap = {};
  for (const row of result.rows) {
    if (isHourInPast(weekStart, row.day_of_week, row.hour)) continue;
    if (!teamsMap[row.id]) teamsMap[row.id] = { name: row.name, days: {} };
    if (!teamsMap[row.id].days[row.day_of_week]) teamsMap[row.id].days[row.day_of_week] = [];
    teamsMap[row.id].days[row.day_of_week].push({ hour: row.hour, blocked: row.is_blocked });
  }

  const teamEntries = Object.entries(teamsMap);

  if (teamEntries.length === 0) {
    await dispChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x4fc3f7)
          .setTitle('Times disponíveis esta semana')
          .setDescription('Nenhum time tem horários futuros essa semana.')
          .setFooter({ text: formatWeekRange(weekStart) }),
      ],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x4fc3f7)
    .setTitle('Times disponíveis esta semana')
    .setFooter({ text: formatWeekRange(weekStart) });

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
          .setCustomId(`proposta:propor:${id}`)
          .setLabel(`Propor para ${t.name}`)
          .setStyle(ButtonStyle.Primary)
      )
    );
    buttonRows.push(row);
  }

  await dispChannel.send({ embeds: [embed], components: buttonRows });
}

async function startFlow(interaction, team, isEdit) {
  const weekStart = getWeekStart();
  const existing = await loadExistingAvailability(team.id, weekStart);

  sessions.set(interaction.user.id, {
    teamId: team.id,
    teamName: team.name,
    team,
    weekStart,
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
    .setDescription(`Semana ${formatWeekRange(weekStart)}${selected ? `\nSelecionados: ${selected}` : ''}`)
    .setFooter({ text: 'Clique nos dias para selecionar. Clique novamente para desmarcar.' });

  await interaction.reply({
    embeds: [embed],
    components: buildDayRows(existing.selectedDays, existing.selectedDays.length > 0, weekStart, existing.lockedHours),
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disponibilidade')
    .setDescription('Cadastra os horários disponíveis do time para a semana'),

  updateDisponibilidadeChannel,
  postAvailabilityToAgenda,

  async execute(interaction) {
    const captainRole = interaction.guild.roles.cache.find(r => r.name === 'Capitão');
    if (!captainRole || !interaction.member.roles.cache.has(captainRole.id)) {
      return interaction.reply({ content: 'Apenas o capitão pode cadastrar a disponibilidade.', flags: MessageFlags.Ephemeral });
    }

    const teamResult = await db.query('SELECT * FROM teams WHERE captain_discord_id = $1', [interaction.user.id]);
    if (teamResult.rows.length === 0) {
      return interaction.reply({ content: 'Você não tem um time cadastrado. Use /cadastrar-time primeiro.', flags: MessageFlags.Ephemeral });
    }

    const team = teamResult.rows[0];
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
      const teamResult = await db.query('SELECT * FROM teams WHERE id = $1', [teamId]);
      if (teamResult.rows.length === 0) {
        return interaction.reply({ content: 'Time não encontrado.', flags: MessageFlags.Ephemeral });
      }
      const team = teamResult.rows[0];
      if (team.captain_discord_id !== interaction.user.id) {
        return interaction.reply({ content: 'Apenas o capitão pode editar a disponibilidade deste time.', flags: MessageFlags.Ephemeral });
      }
      return startFlow(interaction, team, true);
    }

    const session = sessions.get(interaction.user.id);
    if (!session) {
      return interaction.reply({ content: 'Sessão expirada. Use /disponibilidade novamente.', flags: MessageFlags.Ephemeral });
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
        .setDescription(`Semana ${formatWeekRange(session.weekStart)}${selected ? `\nSelecionados: ${selected}` : ''}`)
        .setFooter({ text: 'Clique nos dias para selecionar. Clique novamente para desmarcar.' });

      return interaction.update({ embeds: [embed], components: buildDayRows(session.selectedDays, session.hasExisting, session.weekStart, session.lockedHours) });
    }

    if (action === 'clear') {
      const weekStart = session.weekStart;
      await db.query('DELETE FROM availabilities WHERE team_id = $1 AND week_start = $2 AND is_blocked = false', [session.teamId, weekStart]);

      const clearedEmbed = new EmbedBuilder()
        .setColor(0xe05a5a)
        .setTitle(`Disponibilidade removida: ${session.teamName}`)
        .setDescription('Todos os dias e horários foram removidos.')
        .setFooter({ text: `Semana ${formatWeekRange(weekStart)}` });

      await interaction.update({ embeds: [clearedEmbed], components: [] });

      Promise.all([
        postAvailabilityToAgenda(interaction.guild, session.team, weekStart),
        updateDisponibilidadeChannel(interaction.guild, weekStart),
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

        // Apaga só os não-bloqueados (preserva horários com scrim confirmada)
        await db.query('DELETE FROM availabilities WHERE team_id = $1 AND week_start = $2 AND is_blocked = false', [session.teamId, weekStart]);

        const values = [];
        const params = [];
        let paramIdx = 1;
        for (const day of session.selectedDays) {
          const hours = session.dayHours[day] || [];
          const lockedForDay = session.lockedHours?.[day] || [];
          for (const hour of hours) {
            if (lockedForDay.includes(hour)) continue; // já no banco
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
          .setDescription(lines.length > 0 ? lines.join('\n') : 'Nenhum horário cadastrado.')
          .setFooter({ text: `Semana ${formatWeekRange(weekStart)}` });

        await interaction.update({ embeds: [confirmEmbed], components: [] });

        // Atualizações em background, não bloqueiam a resposta
        Promise.all([
          postAvailabilityToAgenda(interaction.guild, session.team, weekStart),
          updateDisponibilidadeChannel(interaction.guild, weekStart),
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
