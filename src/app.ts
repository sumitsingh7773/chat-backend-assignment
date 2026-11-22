
import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import prisma from "./config/database";
import { getFirestoreClient } from "./config/firebase";
import { openApiDocument } from "./docs/openapi";
import { createChatRouter } from "./routes/chat.routes";
import { createGroupRouter } from "./routes/group.routes";
import { createUserRouter } from "./routes/user.routes";
import { errorHandler } from "./middleware/error-handler";
import { firebaseAuth, TokenVerifier } from "./middleware/firebase-auth";

export function createApp(
  database = prisma,
  firestoreProvider = getFirestoreClient,
  tokenVerifier?: TokenVerifier
) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "16kb" }));

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use("/api", firebaseAuth(tokenVerifier));
  app.use("/chat", firebaseAuth(tokenVerifier));
  app.use("/user", firebaseAuth(tokenVerifier));
  app.use("/api/chats", createChatRouter(database, firestoreProvider));
  app.use("/chat", createChatRouter(database, firestoreProvider));
  app.use("/api/groups", createGroupRouter(database, firestoreProvider));
  app.use("/api/users", createUserRouter(database));
  app.use("/user", createUserRouter(database));
  app.get("/health", (_req, res) => {
    res.status(200).json({
      success: true,
      message: "Chat Backend API is running",
      timestamp: new Date().toISOString(),
    });
  });
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: { message: "Route not found" },
    });
  });
  app.use(errorHandler);

  return app;
}

export default createApp();
