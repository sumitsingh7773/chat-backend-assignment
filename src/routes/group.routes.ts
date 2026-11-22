import { Router } from "express";
import { Firestore } from "firebase-admin/firestore";
import { PrismaClient } from "@prisma/client";
import { ChatService } from "../services/chat.service";
import { GroupService } from "../services/group.service";
import {
  chatIdParams,
  messagesQuery,
  sendMessageBody,
} from "../schemas/chat.schemas";
import {
  addGroupMembersBody,
  createGroupBody,
  groupMemberParams,
  updateGroupBody,
  updateGroupRoleBody,
} from "../schemas/group.schemas";

export function createGroupRouter(
  database: PrismaClient,
  firestoreProvider: () => Firestore
) {
  const router = Router();
  const groups = new GroupService(database);
  const chats = new ChatService(database, firestoreProvider);

  router.post("/", async (req, res) => {
    const { name, description, memberIds } = createGroupBody.parse(req.body);
    const group = await groups.createGroup(
      res.locals.userId,
      name,
      description,
      memberIds
    );
    res.status(201).json({ success: true, data: group });
  });

  router.get("/:chatId", async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const group = await groups.getGroup(chatId, res.locals.userId);
    res.status(200).json({ success: true, data: group });
  });

  router.patch("/:chatId", async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const updates = updateGroupBody.parse(req.body);
    const group = await groups.updateGroup(chatId, res.locals.userId, updates);
    res.status(200).json({ success: true, data: group });
  });

  router.post("/:chatId/members", async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const { userIds } = addGroupMembersBody.parse(req.body);
    const group = await groups.addMembers(chatId, res.locals.userId, userIds);
    res.status(200).json({ success: true, data: group });
  });

  router.delete("/:chatId/members/:userId", async (req, res) => {
    const { chatId, userId } = groupMemberParams.parse(req.params);
    const result = await groups.removeMember(chatId, res.locals.userId, userId);
    res.status(200).json({ success: true, data: result });
  });

  router.patch("/:chatId/members/:userId/role", async (req, res) => {
    const { chatId, userId } = groupMemberParams.parse(req.params);
    const { role } = updateGroupRoleBody.parse(req.body);
    const group = await groups.updateMemberRole(
      chatId,
      res.locals.userId,
      userId,
      role
    );
    res.status(200).json({ success: true, data: group });
  });

  router.post("/:chatId/messages", async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const { content } = sendMessageBody.parse(req.body);
    const message = await chats.sendMessage(chatId, res.locals.userId, content);
    res.status(201).json({ success: true, data: message });
  });

  router.get("/:chatId/messages", async (req, res) => {
    const { chatId } = chatIdParams.parse(req.params);
    const { limit, cursor } = messagesQuery.parse(req.query);
    const result = await chats.getMessages(
      chatId,
      res.locals.userId,
      limit,
      cursor
    );
    res.status(200).json({ success: true, data: result });
  });

  return router;
}
