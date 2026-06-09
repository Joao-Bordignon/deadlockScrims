const db = require('../database');

const CAPTAIN_ROLE_NAME = 'Capitão';
const PLAYER_ROLE_NAME = 'Player';

function getCaptainRole(guild) {
  return guild.roles.cache.find(r => r.name === CAPTAIN_ROLE_NAME);
}

function getPlayerRole(guild) {
  return guild.roles.cache.find(r => r.name === PLAYER_ROLE_NAME);
}

async function getCaptainTeam(member) {
  const captainRole = getCaptainRole(member.guild);
  if (!captainRole || !member.roles.cache.has(captainRole.id)) return null;

  const userRoleIds = [...member.roles.cache.keys()];
  if (userRoleIds.length === 0) return null;

  const result = await db.query(
    'SELECT * FROM teams WHERE role_id = ANY($1::text[])',
    [userRoleIds]
  );
  return result.rows[0] || null;
}

function captainMention(guild) {
  const role = getCaptainRole(guild);
  return role ? `<@&${role.id}>` : '';
}

module.exports = {
  CAPTAIN_ROLE_NAME,
  PLAYER_ROLE_NAME,
  getCaptainRole,
  getPlayerRole,
  getCaptainTeam,
  captainMention,
};
