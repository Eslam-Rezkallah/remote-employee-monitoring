export const successResponse = (
  { res, status: inlineStatus, message = "Success", data = {} },
  positionalStatus,
) => {
  const status = positionalStatus || inlineStatus || 200;
  return res.status(status).json({ message, data });
};
