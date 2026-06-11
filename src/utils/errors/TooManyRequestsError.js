import { AppError } from "./AppError.js";
export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests", details = null) {
    super(message, 429, details);
  }
}
