// Keep the existing API endpoints in one Vercel function so this app fits the Hobby limit.
const handlers = Object.freeze({
  "goals": require("../handlers/goals"),
  "lead-pipeline": require("../handlers/lead-pipeline"),
  "portal-access-admin": require("../handlers/portal-access-admin"),
  "portal-access": require("../handlers/portal-access"),
  "portal-account-purge": require("../handlers/portal-account-purge"),
  "portal-auth": require("../handlers/portal-auth"),
  "portal-content": require("../handlers/portal-content"),
  "portal-leads": require("../handlers/portal-leads"),
  "portal-pipeline": require("../handlers/portal-pipeline"),
  "portal-presence": require("../handlers/portal-presence"),
  "portal-roster": require("../handlers/portal-roster"),
  "queue-events": require("../handlers/queue-events"),
  "quo": require("../handlers/quo"),
  "register-notify": require("../handlers/register-notify"),
  "scrape-maps": require("../handlers/scrape-maps"),
  "team-chat-clear": require("../handlers/team-chat-clear"),
  "team-chat-log": require("../handlers/team-chat-log"),
  "team-chat": require("../handlers/team-chat"),
  "team-room": require("../handlers/team-room"),
  "timeclock": require("../handlers/timeclock"),
  "zoho-mail-callback": require("../handlers/zoho-mail-callback"),
  "zoho-mail": require("../handlers/zoho-mail"),
});

module.exports = async (req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { return res.status(400).json({ error: 'Invalid request URL' }); }
  const match = /^\/api\/([a-z0-9-]+?)(?:\.js)?\/?$/.exec(pathname);
  const handler = match && Object.prototype.hasOwnProperty.call(handlers, match[1])
    ? handlers[match[1]] : null;
  if (!handler) return res.status(404).json({ error: 'Not found' });
  // This is Vercel's generated dynamic route parameter, not application input.
  if (req.query) delete req.query.endpoint;
  return handler(req, res);
};
