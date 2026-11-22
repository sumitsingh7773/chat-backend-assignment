import { z } from "zod";

const identifier = z.string().trim().min(1).max(128);

export const createChatBody = z.object({
  otherUserId: identifier,
}).strict();

export const chatIdParams = z.object({ chatId: identifier });

export const sendMessageBody = z.object({
  content: z.string().trim().min(1).max(5000),
}).strict();

export const messagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: identifier.optional(),
}).strict();

export const markReadParams = z.object({
  chatId: identifier,
  messageId: identifier,
});

export const markReadBody = z.object({}).strict();

export const lastSeenBody = z.object({
  messageId: identifier,
}).strict();

export const assignmentCreateChatBody = z.object({
  userAId: identifier,
  userBId: identifier,
}).strict();

export const assignmentSendMessageBody = z.object({
  senderId: identifier,
  text: z.string().trim().min(1).max(5000),
}).strict();

export const assignmentMessagesQuery = z.object({
  userId: identifier,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: identifier.optional(),
}).strict();

export const assignmentUserBody = z.object({
  userId: identifier,
}).strict();

export const assignmentLastSeenBody = z.object({
  userId: identifier,
  messageId: identifier,
}).strict();
