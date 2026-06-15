const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../database');
const { getActiveWeekStarts } = require('../utils/time');
const { getCaptainTeam } = require('../utils/captain');
const disponibilidade = require('./disponibilidade');

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

function dayButton(d, selectedDays) {
  return new ButtonBuilder()
    .setCustomId(`horario-fixo:day:${d.value}`)
    .setLabel(selectedDays.includes(d.value) ? `${d.label} ✓` : d.label)
    .setStyle(selectedDays.includes(d.value) ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function buildDayRows(selectedDays, hasExisting) {
  const row1 = new ActionRowBuilder().addComponents(DAYS.slice(0, 5).map(d => dayButton(d, selectedDays)));
  const row2 = new ActionRowBuilder().addComponents([
    ...DAYS.slice(5).map(d => dayButton(d, selectedDays)),
    new ButtonBuilder()
      .setCustomId('horario-fixo:days_next')
      .setLabel('Próximo →')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(selectedDays.length === 0),
  ]);
  const rows = [row1, row2];
  if (hasExisting) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('horario-fixo:clear')
        .setLabel('Limpar tudo')
        .setStyle(ButtonStyle.Danger)
    ));
  }
  return rows;
}

function hourButton(h, selectedHours) {
  return new ButtonBuilder()
    .setCustomId(`horario-fixo:hour:${h}`)
    .setLabel(selectedHours.includes(h) ? `${HOUR_LABEL(h)} ✓` : HOUR_LABEL(h))
    .setStyle(selectedHours.includes(h) ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function buildHourRows(selectedHours, isLast) {
  const row1 = new ActionRowBuilder().addComponents(HOURS.slice(0, 5).map(h => hourButton(h, selectedHours)));
  const row2 = new ActionRowBuilder().addComponents([
    ...HOURS.slice(5).map(h => hourButton(h, selectedHours)),
    new ButtonBuilder()
      .setCustomId('horario-fixo:hours_next')
      .setLabel(isLast ? 'Confirmar ✓' : 'Próximo →')
      .setStyle(isLast ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(selectedHours.length === 0),
  ]);
  return [row1, row2];
}

async function loadRecurring(teamId) {
  const result = await db.query(
    'SELECT day_of_week, hour FROM recurring_availability WHERE team_id = $1',
    [teamId]
  );
  const dayHours = {};
  for (const row of result.rows) {
    if (!dayHours[row.day_of_week]) dayHours[row.day_of_week] = [];
    dayHours[row.day_of_week].push(row.hour);
  }
  for (const day of Object.keys(dayHours)) dayHours[day] = sortHours(dayHours[day]);
  const selectedDays = sortDays(Object.keys(dayHours).map(Number));
  return { selectedDays, dayHours };
}

async function applyRecurringToActiveWeeks(teamId) {
  const recurring = await db.query(
    'SELECT day_of_week, hour FROM recurring_availability WHERE team_id = $1',
    [teamId]
  );
  if (recurring.rows.length === 0) return;

  const weekStarts = getActiveWeekStarts();
  const values = [];
  const params = [];
  let idx = 1;
  for (const weekStart of weekStarts) {
    for (const row of recurring.rows) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      params.push(teamId, weekStart, row.day_of_week, row.hour);
    }
  }
  await db.query(
    `INSERT INTO availabilities (team_id, week_start, day_of_week, hour)
     VALUES ${values.join(', ')}
     ON CONFLICT (team_id, week_start, day_of_week, hour) DO NOTHING`,
    params
  );
}

async function seedNewWeekFromRecurring(teamId, weekStart) {
  const recurring = await db.query(
    'SELECT day_of_week, hour FROM recurring_availability WHERE team_id = $1',
    [teamId]
  );
  if (recurring.rows.length === 0) return;
  const values = [];
  const params = [];
  let idx = 1;
  for (const row of recurring.rows) {
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    params.push(teamId, weekStart, row.day_of_week, row.hour);
  }
  await db.query(
    `INSERT INTO availabilities (team_id, week_start, day_of_week, hour)
     VALUES ${values.join(', ')}
     ON CONFLICT (team_id, week_start, day_of_week, hour) DO NOTHING`,
    params
  );
}

async function startFlow(interaction, team) {
  const existing = await loadRecurring(team.id);

  sessions.set(interaction.user.id, {
    teamId: team.id,
    teamName: team.name,
    team,
    selectedDays: existing.selectedDays,
    dayHours: existing.dayHours,
    currentDayIndex: 0,
    step: 'days',
    hasExisting: existing.selectedDays.length > 0,
  });
  setTimeout(() => sessions.delete(interaction.user.id), 10 * 60 * 1000);

  const selected = existing.selectedDays.map(d => DAYS.find(x => x.value === d).label).join(', ');
  const embed = new EmbedBuilder()
    .setColor(0x4fc3f7)
    .setTitle('Horário fixo: selecione os dias')
    .setDescription(
      'Defina os dias e horários em que seu time joga toda semana. ' +
      'Este template é aplicado automaticamente nas próximas 3 semanas e em qualquer nova semana que entrar.\n\n' +
      'Você ainda pode editar uma semana específica em /disponibilidade caso precise abrir exceção.' +
      (selected ? `\n\nSelecionados: ${selected}` : '')
    )
    .setFooter({ text: 'Clique nos dias para selecionar. Clique novamente para desmarcar.' });

  return interaction.reply({
    embeds: [embed],
    components: buildDayRows(existing.selectedDays, existing.selectedDays.length > 0),
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('horario-fixo')
    .setDescription('Define horários fixos do time que se repetem em todas as semanas'),

  seedNewWeekFromRecurring,

  async execute(interaction) {
    const team = await getCaptainTeam(interaction.member);
    if (!team) {
      return interaction.reply({ content: 'Apenas capitães podem definir horários fixos.', flags: MessageFlags.Ephemeral });
    }
    if (team.suspended_until && new Date(team.suspended_until) > new Date()) {
      return interaction.reply({ content: `Seu time está suspenso. Motivo: ${team.suspension_reason || 'não informado'}.`, flags: MessageFlags.Ephemeral });
    }
    await startFlow(interaction, team);
  },

  async handleComponent(interaction) {
    const parts = interaction.customId.split(':');
    const action = parts[1];

    const session = sessions.get(interaction.user.id);
    if (!session) {
      return interaction.reply({ content: 'Sessão expirada. Use /horario-fixo novamente.', flags: MessageFlags.Ephemeral });
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
        .setTitle('Horário fixo: selecione os dias')
        .setDescription(selected ? `Selecionados: ${selected}` : 'Clique nos dias para selecionar.')
        .setFooter({ text: 'Clique novamente para desmarcar.' });
      return interaction.update({
        embeds: [embed],
        components: buildDayRows(session.selectedDays, session.hasExisting),
      });
    }

    if (action === 'clear') {
      await db.query('DELETE FROM recurring_availability WHERE team_id = $1', [session.teamId]);
      const embed = new EmbedBuilder()
        .setColor(0xe05a5a)
        .setTitle(`Horário fixo removido: ${session.teamName}`)
        .setDescription('O template recorrente foi apagado. As semanas já cadastradas permanecem como estavam.\n\nNovas semanas não terão horários pré-cadastrados até você definir um novo /horario-fixo.');
      await interaction.update({ embeds: [embed], components: [] });
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
        .setTitle(`${DAY_NAME[currentDay]}: selecione os horários (1 de ${session.selectedDays.length})`)
        .setDescription(preLoaded.length > 0 ? `Selecionados: ${preLoaded.map(HOUR_LABEL).join(' · ')}` : 'Clique nos horários para selecionar.')
        .setFooter({ text: 'Clique novamente para desmarcar.' });
      return interaction.update({ embeds: [embed], components: buildHourRows(preLoaded, isLast) });
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
        .setTitle(`${DAY_NAME[currentDay]}: selecione os horários (${session.currentDayIndex + 1} de ${session.selectedDays.length})`)
        .setDescription(selected.length > 0 ? `Selecionados: ${selected.map(HOUR_LABEL).join(' · ')}` : 'Clique nos horários para selecionar.')
        .setFooter({ text: 'Clique novamente para desmarcar.' });
      return interaction.update({ embeds: [embed], components: buildHourRows(selected, isLast) });
    }

    if (action === 'hours_next') {
      const isLast = session.currentDayIndex === session.selectedDays.length - 1;

      if (isLast) {
        await db.query('DELETE FROM recurring_availability WHERE team_id = $1', [session.teamId]);

        const values = [];
        const params = [];
        let idx = 1;
        for (const day of session.selectedDays) {
          const hours = session.dayHours[day] || [];
          for (const hour of hours) {
            values.push(`($${idx++}, $${idx++}, $${idx++})`);
            params.push(session.teamId, day, hour);
          }
        }
        if (values.length > 0) {
          await db.query(
            `INSERT INTO recurring_availability (team_id, day_of_week, hour) VALUES ${values.join(', ')}`,
            params
          );
          await applyRecurringToActiveWeeks(session.teamId);
        }

        const lines = session.selectedDays
          .filter(d => session.dayHours[d]?.length > 0)
          .map(d => `${DAY_NAME[d]}: ${session.dayHours[d].map(HOUR_LABEL).join(' · ')}`);

        const confirmEmbed = new EmbedBuilder()
          .setColor(0x4caf82)
          .setTitle(`Horário fixo salvo: ${session.teamName}`)
          .setDescription(`${lines.length > 0 ? lines.join('\n') : 'Nenhum horário cadastrado.'}\n\nEste template foi aplicado nas 3 semanas ativas e será replicado em toda semana nova que entrar.`)
          .setFooter({ text: 'Para mudar em uma semana específica, use /disponibilidade.' });

        await interaction.update({ embeds: [confirmEmbed], components: [] });

        Promise.all([
          disponibilidade.postAllAvailabilityToAgenda(interaction.guild, session.team),
          disponibilidade.updateAllDisponibilidadeChannel(interaction.guild),
        ]).catch(err => console.error('Erro ao atualizar canais após horário fixo:', err));

        sessions.delete(interaction.user.id);
      } else {
        session.currentDayIndex++;
        const nextDay = session.selectedDays[session.currentDayIndex];
        const nextIsLast = session.currentDayIndex === session.selectedDays.length - 1;
        const preLoaded = session.dayHours[nextDay] || [];
        const embed = new EmbedBuilder()
          .setColor(0x4fc3f7)
          .setTitle(`${DAY_NAME[nextDay]}: selecione os horários (${session.currentDayIndex + 1} de ${session.selectedDays.length})`)
          .setDescription(preLoaded.length > 0 ? `Selecionados: ${preLoaded.map(HOUR_LABEL).join(' · ')}` : 'Clique nos horários para selecionar.')
          .setFooter({ text: 'Clique novamente para desmarcar.' });
        return interaction.update({ embeds: [embed], components: buildHourRows(preLoaded, nextIsLast) });
      }
    }
  },
};
