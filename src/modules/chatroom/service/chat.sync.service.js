/**
 * modules/chatroom/service/chat.sync.service.js
 *
 * Keeps the implicit chat rooms (team chat, project channel, org chat)
 * in sync with their source-of-truth collections (team, project, org).
 *
 * Why this exists
 * ───────────────
 * Slack/Teams give you a default channel per team and an #all-hands per
 * workspace. Membership of those rooms is NOT independent — it follows
 * the team/workspace roster. Before this module:
 *   • Team chat was created with team.members snapshot and never updated.
 *   • Adding a new team member did NOT add them to the existing team chat.
 *   • Same for project channels and org-wide chat.
 *
 * Design rules
 * ────────────
 *   • Every function is a no-op if the corresponding room doesn't exist
 *     yet (rooms are still created lazily on demand). This means callers
 *     can fire-and-forget without checking.
 *   • Errors are LOGGED, not thrown. A failed sync must not block the
 *     parent operation (e.g. team.addMember succeeding but team-chat
 *     sync failing should still let the team membership change persist).
 *   • Socket eviction runs for removed members so their open tabs/devices
 *     stop receiving messages from rooms they no longer belong to.
 */

import chatRoomModel, {
  chatRoomTypes,
} from "../../../DB/Model/chatroom.model.js";
import teamModel from "../../../DB/Model/team.model.js";
import projectModel from "../../../DB/Model/project.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import { forceUserLeaveRoom } from "../../socket/util/socket-room.util.js";
import { childLogger } from "../../../utils/logger/logger.js";

const log = childLogger("chat-sync");

/** Compare two ObjectId arrays as string sets, return {added, removed}. */
function diffMembers(currentIds, desiredIds) {
  const current = new Set(currentIds.map((id) => id.toString()));
  const desired = new Set(desiredIds.map((id) => id.toString()));
  const added = [...desired].filter((id) => !current.has(id));
  const removed = [...current].filter((id) => !desired.has(id));
  return { added, removed };
}

async function evictRemovedSockets(removedIds, roomId) {
  await Promise.allSettled(
    removedIds.map((uid) => forceUserLeaveRoom(uid, roomId)),
  );
}

/**
 * Sync the team's chat room to mirror team.members + team.managers.
 *   - members        ← team.members
 *   - admins         ← team.managers ∪ {team.createdBy}
 *
 * Removed users get kicked from the room AND from any open sockets.
 * No-op if no team chat exists yet.
 */
export async function syncTeamChatMembership(teamId) {
  if (!teamId) return;

  try {
    const team = await teamModel.findById(teamId).lean();
    if (!team || team.isDeleted) return;

    const room = await chatRoomModel
      .findOne({
        type: chatRoomTypes.team,
        teamId,
        isDeleted: false,
      })
      .lean();
    if (!room) return; // chat hasn't been created yet — nothing to sync

    const desiredMembers = (team.members || []).map((m) => m.toString());
    const desiredAdmins = [
      ...new Set(
        [
          team.createdBy?.toString(),
          ...(team.managers || []).map((m) => m.toString()),
        ].filter(Boolean),
      ),
    ];

    const { added, removed } = diffMembers(room.members || [], desiredMembers);

    if (added.length === 0 && removed.length === 0) {
      // Only admins may have shifted — write that without scanning members.
      await chatRoomModel.updateOne(
        { _id: room._id },
        { $set: { admins: desiredAdmins } },
      );
      return;
    }

    await chatRoomModel.updateOne(
      { _id: room._id },
      {
        $set: { members: desiredMembers, admins: desiredAdmins },
      },
    );

    if (removed.length) await evictRemovedSockets(removed, room._id);

    log.debug(
      {
        roomId: room._id,
        teamId,
        added: added.length,
        removed: removed.length,
      },
      "team chat membership synced",
    );
  } catch (err) {
    log.error({ err, teamId }, "syncTeamChatMembership failed");
  }
}

/**
 * Sync every project-scoped channel for this project so their members
 * mirror project.members. Project channels can be many (one per topic),
 * so we update all of them in a single pass.
 *
 * The project manager is forced into the admins set on every sync so
 * transferring the manager role automatically updates the channel admins.
 */
export async function syncProjectChannelMembership(projectId) {
  if (!projectId) return;

  try {
    const project = await projectModel.findById(projectId).lean();
    if (!project || project.isDeleted) return;

    const rooms = await chatRoomModel
      .find({
        type: chatRoomTypes.channel,
        projectId,
        isDeleted: false,
      })
      .lean();
    if (rooms.length === 0) return;

    const desiredMembers = (project.members || []).map((m) => m.toString());
    const managerId = project.manager?.toString();

    for (const room of rooms) {
      // Preserve any extra channel admins (people promoted within the
      // channel itself); just make sure the project manager is always
      // an admin even if they get demoted from a custom channel role.
      const currentAdmins = (room.admins || []).map((a) => a.toString());
      const desiredAdmins = managerId
        ? [...new Set([...currentAdmins, managerId])]
        : currentAdmins;

      // A user removed from the project must lose admin powers there.
      const desiredMembersSet = new Set(desiredMembers);
      const cleanedAdmins = desiredAdmins.filter(
        (a) => desiredMembersSet.has(a) || a === managerId,
      );

      const { added, removed } = diffMembers(
        room.members || [],
        desiredMembers,
      );

      await chatRoomModel.updateOne(
        { _id: room._id },
        { $set: { members: desiredMembers, admins: cleanedAdmins } },
      );

      if (removed.length) await evictRemovedSockets(removed, room._id);

      log.debug(
        {
          roomId: room._id,
          projectId,
          added: added.length,
          removed: removed.length,
        },
        "project channel membership synced",
      );
    }
  } catch (err) {
    log.error({ err, projectId }, "syncProjectChannelMembership failed");
  }
}

/**
 * Incremental sync for the organization-wide chat. Orgs can have
 * thousands of members so we avoid full reconciliation here — callers
 * pass the deltas explicitly when they happen.
 *
 *   onMemberJoined  →  syncOrgChatOnMemberChange(orgId, { addUserId: id })
 *   onMemberLeft    →  syncOrgChatOnMemberChange(orgId, { removeUserId: id })
 *   onPromotion     →  syncOrgChatOnMemberChange(orgId, { promoteUserId: id })
 *   onDemotion      →  syncOrgChatOnMemberChange(orgId, { demoteUserId: id })
 */
export async function syncOrgChatOnMemberChange(orgId, delta = {}) {
  if (!orgId) return;
  const { addUserId, removeUserId, promoteUserId, demoteUserId } = delta;

  try {
    const room = await chatRoomModel
      .findOne({
        type: chatRoomTypes.organization,
        organizationId: orgId,
        isDeleted: false,
      })
      .select("_id");
    if (!room) return; // org chat not created yet

    const update = {};

    if (addUserId) {
      update.$addToSet = { ...(update.$addToSet || {}), members: addUserId };
    }
    if (removeUserId) {
      update.$pull = {
        ...(update.$pull || {}),
        members: removeUserId,
        admins: removeUserId,
      };
    }
    if (promoteUserId) {
      // Promote to admin in the room. We don't validate the org role here —
      // the caller is responsible for only promoting actual org admins.
      update.$addToSet = {
        ...(update.$addToSet || {}),
        admins: promoteUserId,
      };
    }
    if (demoteUserId) {
      update.$pull = { ...(update.$pull || {}), admins: demoteUserId };
    }

    if (Object.keys(update).length === 0) return;

    await chatRoomModel.updateOne({ _id: room._id }, update);

    if (removeUserId) await evictRemovedSockets([removeUserId], room._id);

    log.debug(
      { roomId: room._id, orgId, delta },
      "org chat membership delta applied",
    );
  } catch (err) {
    log.error({ err, orgId, delta }, "syncOrgChatOnMemberChange failed");
  }
}

/**
 * Full reconciliation for the org chat. Use this for recovery (cron job
 * or admin endpoint) — NOT in the hot path. Walks all active org members
 * and writes the full set.
 */
export async function reconcileOrgChatMembership(orgId) {
  if (!orgId) return;

  try {
    const room = await chatRoomModel
      .findOne({
        type: chatRoomTypes.organization,
        organizationId: orgId,
        isDeleted: false,
      })
      .lean();
    if (!room) return;

    const members = await memberModel
      .find({ organizationId: orgId, isActive: true })
      .select("userId role")
      .lean();

    const desiredMembers = members.map((m) => m.userId.toString());
    const desiredAdmins = members
      .filter((m) => ["owner", "admin"].includes(m.role))
      .map((m) => m.userId.toString());

    const { added, removed } = diffMembers(room.members || [], desiredMembers);

    await chatRoomModel.updateOne(
      { _id: room._id },
      { $set: { members: desiredMembers, admins: desiredAdmins } },
    );

    if (removed.length) await evictRemovedSockets(removed, room._id);

    log.info(
      {
        roomId: room._id,
        orgId,
        added: added.length,
        removed: removed.length,
      },
      "org chat fully reconciled",
    );
  } catch (err) {
    log.error({ err, orgId }, "reconcileOrgChatMembership failed");
  }
}
