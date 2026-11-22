import { z } from "zod";

const identifier = z.string().trim().min(1).max(128);

export const createGroupBody = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  memberIds: z.array(identifier).max(99).default([]),
}).strict();

export const addGroupMembersBody = z.object({
  userIds: z.array(identifier).min(1).max(99),
}).strict();

export const updateGroupBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
}).strict().refine(
  (value) => value.name !== undefined || value.description !== undefined,
  { message: "At least one group field must be provided" }
);

export const groupMemberParams = z.object({
  chatId: identifier,
  userId: identifier,
});

export const updateGroupRoleBody = z.object({
  role: z.enum(["ADMIN", "MEMBER"]),
}).strict();
