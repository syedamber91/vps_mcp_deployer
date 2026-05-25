import type { Request, Response, NextFunction } from "express";

export function verifyToken(authHeader: string | undefined): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice(7);
  return token === process.env.AUTH_TOKEN;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (verifyToken(req.headers.authorization)) {
    next();
  } else {
    res.status(401).json({ success: false, error: "Unauthorized" });
  }
}
