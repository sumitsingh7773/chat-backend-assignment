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
