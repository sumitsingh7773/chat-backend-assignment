import { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/app-error";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: { message: error.message },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        message: "Invalid request",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({
      success: false,
      error: { message: "Invalid JSON request body" },
    });
    return;
  }

  if (hasErrorType(error, "entity.too.large")) {
    res.status(413).json({
      success: false,
      error: { message: "Request body is too large" },
    });
    return;
  }

  console.error("Unhandled request error", error);
  res.status(500).json({
    success: false,
    error: { message: "Internal server error" },
  });
};

function hasErrorType(error: unknown, type: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === type
  );
}
