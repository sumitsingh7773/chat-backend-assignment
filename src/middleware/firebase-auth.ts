import { NextFunction, Request, Response } from "express";
import { getFirebaseApp } from "../config/firebase";
import { AppError } from "../errors/app-error";

export type TokenVerifier = (token: string) => Promise<string>;

export const verifyFirebaseIdToken: TokenVerifier = async (token) => {
  const { getAuth } = await import("firebase-admin/auth");
  const decodedToken = await getAuth(getFirebaseApp()).verifyIdToken(token);
  return decodedToken.uid;
};

export function firebaseAuth(verifier: TokenVerifier = verifyFirebaseIdToken) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authorization = req.get("authorization");
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      next(new AppError(401, "A valid Firebase bearer token is required"));
      return;
    }

    try {
      res.locals.userId = await verifier(match[1]);
      next();
    } catch (error) {
      if (isFirebaseAuthError(error)) {
        next(new AppError(401, "Invalid or expired Firebase ID token"));
        return;
      }
      next(error);
    }
  };
}

function isFirebaseAuthError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("auth/")
  );
}
