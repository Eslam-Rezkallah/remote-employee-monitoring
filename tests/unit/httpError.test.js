/**
 * tests/unit/httpError.test.js
 *
 * Smoke coverage for the httpError factory. Pinning these mappings
 * because a lot of services + tests assume `httpError(404, ...)`
 * always produces a NotFoundError with statusCode 404 and a
 * truthy isOperational flag.
 */
import { jest } from "@jest/globals";
import {
  httpError,
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
} from "../../src/utils/errors/index.js";

describe("httpError factory", () => {
  test("400 → BadRequestError", () => {
    const e = httpError(400, "bad");
    expect(e).toBeInstanceOf(BadRequestError);
    expect(e.statusCode).toBe(400);
    expect(e.message).toBe("bad");
    expect(e.isOperational).toBe(true);
  });

  test("401 → UnauthorizedError", () => {
    const e = httpError(401, "auth");
    expect(e).toBeInstanceOf(UnauthorizedError);
    expect(e.statusCode).toBe(401);
  });

  test("403 → ForbiddenError + carries details", () => {
    const e = httpError(403, "no", { reason: "role" });
    expect(e).toBeInstanceOf(ForbiddenError);
    expect(e.statusCode).toBe(403);
    expect(e.details).toEqual({ reason: "role" });
  });

  test("404 → NotFoundError", () => {
    const e = httpError(404, "missing");
    expect(e).toBeInstanceOf(NotFoundError);
  });

  test("409 → ConflictError", () => {
    expect(httpError(409, "dup")).toBeInstanceOf(ConflictError);
  });

  test("429 → TooManyRequestsError", () => {
    expect(httpError(429, "slow down")).toBeInstanceOf(TooManyRequestsError);
  });

  test("uncommon status → generic AppError preserving the code", () => {
    const e = httpError(418, "tea");
    expect(e).toBeInstanceOf(AppError);
    expect(e.statusCode).toBe(418);
  });

  test("every produced error has captureStackTrace + name", () => {
    const e = httpError(404, "x");
    expect(e.name).toBe("NotFoundError");
    expect(typeof e.stack).toBe("string");
  });
});
