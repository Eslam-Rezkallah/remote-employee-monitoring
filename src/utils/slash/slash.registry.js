/**
 * utils/slash/slash.registry.js
 *
 * Slack-style slash commands. A user types `/cmd arg1 arg2` into a
 * chat message; if the leading token is a registered command we
 * dispatch its handler INSTEAD of saving the message (or alongside,
 * depending on the command's `ephemeral` flag).
 *
 * Design:
 *   • Built-ins ship in src/modules/message/slash/* and self-register
 *     on first import.
 *   • Each handler receives `{ args, user, room, app }` and returns
 *     `{ replyToUser, broadcast, suppressMessage }`.
 *       - replyToUser: text shown only to the sender (ephemeral)
 *       - broadcast:   text posted to the room as a system message
 *       - suppressMessage: when true, the original "/cmd ..." text
 *         is NOT saved as a regular message
 *
 * Permissions: each command declares its own access predicate. The
 * dispatcher refuses the call BEFORE invoking the handler so handlers
 * stay focused on logic.
 */

import { childLogger } from "../logger/logger.js";

const log = childLogger("slash");

const _commands = new Map();

/**
 * Register a slash command.
 *
 *   registerSlash({
 *     name: "shrug",
 *     description: "Posts ¯\\_(ツ)_/¯",
 *     usage: "/shrug",
 *     ephemeral: false,
 *     can: ({ room, user }) => true,
 *     handler: async ({ args, user, room }) => ({ broadcast: "¯\\_(ツ)_/¯", suppressMessage: true }),
 *   });
 */
export function registerSlash(spec) {
  if (!spec?.name || !spec?.handler) {
    throw new Error("registerSlash requires { name, handler }");
  }
  if (_commands.has(spec.name)) {
    log.warn({ name: spec.name }, "slash command overwritten");
  }
  _commands.set(spec.name.toLowerCase(), {
    ephemeral: false,
    can: () => true,
    ...spec,
  });
}

/** Used by /docs and the auto-complete UI. */
export function listSlashCommands() {
  return [..._commands.values()].map((c) => ({
    name: c.name,
    description: c.description || "",
    usage: c.usage || `/${c.name}`,
  }));
}

/**
 * Detect + parse a slash-command intent from raw message content.
 * Returns `{ name, args }` or null when the content isn't a command.
 * Tolerates whitespace, quoted args ("two words"), and trailing punctuation.
 */
export function parseSlashIntent(content) {
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) return null;
  // Match the command token (a-z, 0-9, _, -)
  const m = /^\/([a-z0-9_-]{1,32})\b\s*([\s\S]*)$/i.exec(trimmed);
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (!_commands.has(name)) return null;
  const args = parseArgs(m[2] || "");
  return { name, args, raw: trimmed };
}

/**
 * Execute a previously-parsed intent. Returns the handler result + the
 * command spec for the caller to act on.
 */
export async function dispatchSlash({ intent, user, room, app }) {
  const cmd = _commands.get(intent.name);
  if (!cmd) {
    return {
      replyToUser: `Unknown command: /${intent.name}`,
      suppressMessage: true,
    };
  }

  let allowed = true;
  try {
    allowed = await cmd.can({ user, room, args: intent.args });
  } catch (err) {
    log.warn({ err, cmd: intent.name }, "slash command `can` threw");
    allowed = false;
  }
  if (!allowed) {
    return {
      replyToUser: `You don't have permission to use /${intent.name}`,
      suppressMessage: true,
    };
  }

  try {
    const result = await cmd.handler({
      args: intent.args,
      user,
      room,
      app,
    });
    return {
      replyToUser: null,
      broadcast: null,
      suppressMessage: false,
      ...result,
    };
  } catch (err) {
    log.error({ err, cmd: intent.name }, "slash command handler threw");
    return {
      replyToUser: `/${intent.name} failed: ${err.message}`,
      suppressMessage: true,
    };
  }
}

/**
 * Light argument parser. Splits on whitespace but respects double-quoted
 * groups. Slack-comparable for the common cases — fancy escaping is
 * unnecessary for our built-ins.
 */
function parseArgs(rest) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(rest)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}
