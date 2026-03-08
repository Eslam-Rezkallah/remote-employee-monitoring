import { asyncHandler } from "../utils/response/error.response.js";
import { logActivity } from "../utils/activity/activity.logger.js";

export const activityLogging = () => {
  return asyncHandler(async (req, res, next) => {
    req.logActivity = async (payload = {}) => {
      const orgId =
        payload.orgId || req.params?.orgId || req.body?.orgId || req.query?.orgId;
      const spaceId =
        payload.spaceId || req.params?.spaceId || req.body?.spaceId || req.query?.spaceId || null;

      return logActivity({
        actorId: req.user?._id,
        orgId,
        spaceId,
        ...payload,
      });
    };

    return next();
  });
};
