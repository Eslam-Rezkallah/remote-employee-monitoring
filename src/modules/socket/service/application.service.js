import { socketConnection } from "../../../DB/model/user.model.js";

export const sendNotification = (io, userId, eventName, data) => {
  const userSocketId = socketConnection.get(userId.toString());

  if (!userSocketId) {
    return;
  }

  io.to(userSocketId).emit(eventName, data);
};

export const notifyNewApplication = (io, application, job, user) => {
  const notifyData = {
    applicationId: application._id,
    jobTitle: job.jobTitle,
    userName: `${user.firstName} ${user.lastName}`,
    message: `New application submitted by ${user.firstName} ${user.lastName} for ${job.jobTitle}`,
  };

  for (const hrId of job.companyId.HRs) {
    sendNotification(io, hrId, "newApplication", notifyData);
  }

  sendNotification(io, job.addedBy, "newApplication", notifyData);
};
