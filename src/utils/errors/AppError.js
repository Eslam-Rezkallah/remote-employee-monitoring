/**
 * Base class for all expected errors in the app.
 * Anything extending AppError is safe to show the user.
 * Anything else = unexpected bug → generic 500.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}
