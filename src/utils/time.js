const HOUR_LABEL = h => h === 0 ? '00h' : `${h}h`;
const HOUR_TIME = h => h === 0 ? '00:00' : `${String(h).padStart(2, '0')}:00`;
const DAY_NAME = { 0: 'Domingo', 1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira', 4: 'Quinta-feira', 5: 'Sexta-feira', 6: 'Sábado' };
const SHORT_DAY = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };

function getWeekStart(date = new Date()) {
  const day = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getWeekStartOffset(weeksAhead = 0, from = new Date()) {
  const start = getWeekStart(from);
  start.setDate(start.getDate() + weeksAhead * 7);
  return start;
}

function getActiveWeekStarts() {
  return [0, 1, 2].map(n => getWeekStartOffset(n));
}

function weekLabel(weeksAhead) {
  if (weeksAhead === 0) return 'Semana atual';
  if (weeksAhead === 1) return 'Próxima semana';
  return `Daqui a ${weeksAhead} semanas`;
}

function formatWeekRange(weekStart) {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  return `${formatDate(weekStart)} a ${formatDate(end)}`;
}

function formatDate(date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function dayOffsetFromMonday(dayOfWeek) {
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
}

function getScheduledAt(weekStart, dayOfWeek, hour) {
  const date = new Date(weekStart);
  const offset = dayOffsetFromMonday(dayOfWeek) + (hour === 0 ? 1 : 0);
  date.setDate(date.getDate() + offset);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function isDayInPast(weekStart, dayValue) {
  // Dia é considerado passado quando até o slot mais tardio (0h = dia seguinte 00:00) já passou
  const latestSlot = getScheduledAt(weekStart, dayValue, 0);
  return latestSlot < new Date();
}

function isHourInPast(weekStart, dayValue, hour) {
  return getScheduledAt(weekStart, dayValue, hour) < new Date();
}

function sortDays(days) {
  return [...days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
}

function sortHours(hours) {
  return [...hours].sort((a, b) => (a === 0 ? 24 : a) - (b === 0 ? 24 : b));
}

module.exports = {
  HOUR_LABEL,
  HOUR_TIME,
  DAY_NAME,
  SHORT_DAY,
  getWeekStart,
  getWeekStartOffset,
  getActiveWeekStarts,
  weekLabel,
  formatWeekRange,
  formatDate,
  getScheduledAt,
  sortDays,
  sortHours,
  dayOffsetFromMonday,
  isDayInPast,
  isHourInPast,
};
