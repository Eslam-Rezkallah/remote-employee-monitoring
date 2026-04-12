export const asyncHandler = (fn) => {
  return (req, res, next) => {
    return fn(req, res, next).catch((error) => {
      return next(error);
    });
  };
};

// FIX: was returning nothing in PROD so all error requests hung forever
export const globalErrorHandling = (error, req, res, next) => {
  const status = error.cause || 500;
  const message = error.message || "Internal Server Error";

  if (process.env.MOOD === "DEV") {
    return res.status(status).json({ message, error });
  }

  // PROD: never expose stack trace
  return res.status(status).json({ message });
};
