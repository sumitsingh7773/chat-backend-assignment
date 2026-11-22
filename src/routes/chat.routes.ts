import { RequestHandler, Router } from "express";
import { Firestore } from "firebase-admin/firestore";
import { PrismaClient } from "@prisma/client";
import { ChatService } from "../services/chat.service";
import { AppError } from "../errors/app-error";
import {
  assignmentCreateChatBody,
  assignmentLastSeenBody,
  assignmentMessagesQuery,
  assignmentSendMessageBody,
  assignmentUserBody,
  chatIdParams,
  createChatBody,
  lastSeenBody,
  markReadBody,
  markReadParams,
  messagesQuery,
  sendMessageBody,
} from "../schemas/chat.schemas";

export function createChatRouter(
  database: PrismaClient,
  firestoreProvider: () => Firestore
) {
  const router = Router();
  const service = new ChatService(database, firestoreProvider);

  router.post("/create", assignmentRouteOnly, async (req, res) => {
    const { userAId, userBId } = assignmentCreateChatBody.parse(req.body);
    const userId = requireVerifiedUser(res.locals.userId, userAId);
    const chat = await service.getOrCreateOneToOneChat(userId, userBId);
    res.status(200).json({ success: true, data: chat });
  });

  router.post("/:chatId/message/send", assignmentRouteOnly, async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const { senderId, text } = assignmentSendMessageBody.parse(req.body);
    const userId = requireVerifiedUser(res.locals.userId, senderId);
    const message = await service.sendMessage(chatId, userId, text);
    res.status(201).json({
      success: true,
      data: { ...message, text },
    });
  });

  router.get("/:chatId/messages", assignmentRouteOnly, async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const { userId: requestedUserId, limit, cursor } =
      assignmentMessagesQuery.parse(req.query);
    const userId = requireVerifiedUser(res.locals.userId, requestedUserId);
    const result = await service.getMessages(chatId, userId, limit, cursor);
    res.status(200).json({
      success: true,
      data: {
        ...result,
        messages: result.messages.map((message) => ({
          ...message,
          text: message.content,
        })),
      },
    });
  });

  router.post("/:chatId/message/:messageId/read", assignmentRouteOnly, async (req, res) => {
    const { chatId, messageId } = markReadParams.parse(req.params);
    const { userId: requestedUserId } = assignmentUserBody.parse(req.body);
    const userId = requireVerifiedUser(res.locals.userId, requestedUserId);
    const result = await service.markMessageRead(chatId, messageId, userId);
    res.status(200).json({ success: true, data: result });
  });

  router.post("/:chatId/lastseen", assignmentRouteOnly, async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const { userId: requestedUserId, messageId } =
      assignmentLastSeenBody.parse(req.body);
    const userId = requireVerifiedUser(res.locals.userId, requestedUserId);
    const result = await service.updateLastSeen(chatId, userId, messageId);
    res.status(200).json({ success: true, data: result });
  });

  router.post("/", async (req, res) => {
    const { otherUserId } = createChatBody.parse(req.body);
    const userId = res.locals.userId;
    const chat = await service.getOrCreateOneToOneChat(userId, otherUserId);
    res.status(200).json({ success: true, data: chat });
  });

  router.post("/:chatId/messages", async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const { content } = sendMessageBody.parse(req.body);
    const userId = res.locals.userId;
    const message = await service.sendMessage(chatId, userId, content);
    res.status(201).json({ success: true, data: message });
  });

  router.get("/:chatId/messages", async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const { limit, cursor } = messagesQuery.parse(req.query);
    const userId = res.locals.userId;
    const result = await service.getMessages(chatId, userId, limit, cursor);
    res.status(200).json({ success: true, data: result });
  });

  router.patch("/:chatId/messages/:messageId/read", async (req, res) => {
    const { chatId, messageId } = markReadParams.parse(req.params);
    markReadBody.parse(req.body ?? {});
    const userId = res.locals.userId;
    const result = await service.markMessageRead(chatId, messageId, userId);
    res.status(200).json({ success: true, data: result });
  });

  router.patch("/:chatId/last-seen", async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const { messageId } = lastSeenBody.parse(req.body);
    const userId = res.locals.userId;
    const result = await service.updateLastSeen(chatId, userId, messageId);
    res.status(200).json({ success: true, data: result });
  });

  return router;
}

function requireVerifiedUser(
  authenticatedUserId: string,
  requestedUserId: string
): string {
  if (authenticatedUserId !== requestedUserId) {
    throw new AppError(403, "User identity must match the authenticated account");
  }
  return authenticatedUserId;
}

const assignmentRouteOnly: RequestHandler = (req, _res, next) => {
  if (req.baseUrl === "/chat") {
    next();
    return;
  }
  next("route");
};
