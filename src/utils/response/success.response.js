/**
 * Standardized success response.
 *
 * Usage:
 *   return successResponse({ res, message: "Done", data: { user } });
 *   return successResponse({ res, status: 201, message: "Created", data });
 *   return successResponse({ res, data }, 201);  // legacy positional status
 *
 * Always emits:
 *   { success: true, message, data }
 */
export const successResponse = (
  { res, status: inlineStatus, message = "Success", data = null, meta } = {},
  positionalStatus,
) => {
  const status = positionalStatus || inlineStatus || 200;
  const body = {
    success: true,
    message,
    data,
  };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};
