import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyToken, authMiddleware } from "../src/auth.js";
import type { Request, Response, NextFunction } from "express";

describe("verifyToken", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_TOKEN", "test-secret-token");
  });

  it("returns true for valid Bearer token", () => {
    expect(verifyToken("Bearer test-secret-token")).toBe(true);
  });

  it("returns false for invalid token", () => {
    expect(verifyToken("Bearer wrong-token")).toBe(false);
  });

  it("returns false for missing Bearer prefix", () => {
    expect(verifyToken("test-secret-token")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(verifyToken("")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(verifyToken(undefined)).toBe(false);
  });
});

describe("authMiddleware", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_TOKEN", "test-secret-token");
  });

  it("calls next() for valid token", () => {
    const req = { headers: { authorization: "Bearer test-secret-token" } } as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 401 for invalid token", () => {
    const req = { headers: { authorization: "Bearer wrong" } } as Request;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as unknown as Response;
    const next = vi.fn() as NextFunction;

    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ success: false, error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });
});
