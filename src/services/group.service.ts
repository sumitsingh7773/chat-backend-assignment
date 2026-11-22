import {
  ChatMemberRole,
  ChatType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { AppError } from "../errors/app-error";

export class GroupService {
  constructor(private readonly database: PrismaClient) {}

  async createGroup(
    creatorId: string,
    name: string,
    description: string | undefined,
    requestedMemberIds: string[]
  ) {
    const memberIds = [...new Set(requestedMemberIds)].filter(
      (userId) => userId !== creatorId
    );
    const allUserIds = [creatorId, ...memberIds];
    const users = await this.database.user.findMany({
      where: { id: { in: allUserIds } },
      select: { id: true },
    });
    if (users.length !== allUserIds.length) {
      throw new AppError(404, "One or more users not found");
    }

    return this.database.chat.create({
      data: {
        type: ChatType.GROUP,
        name,
        description,
        members: {
          create: [
            { userId: creatorId, role: ChatMemberRole.ADMIN },
            ...memberIds.map((userId) => ({
              userId,
              role: ChatMemberRole.MEMBER,
            })),
          ],
        },
      },
      include: { members: { select: { userId: true, role: true, joinedAt: true } } },
    });
  }

  async getGroup(chatId: string, userId: string) {
    const group = await this.requireGroupMember(this.database, chatId, userId);
    return group;
  }

  async updateGroup(
    chatId: string,
    userId: string,
    updates: { name?: string; description?: string | null }
  ) {
    return this.database.$transaction(
      async (transaction) => {
        await this.requireGroupAdmin(transaction, chatId, userId);
        return transaction.chat.update({
          where: { id: chatId },
          data: updates,
          include: {
            members: { select: { userId: true, role: true, joinedAt: true } },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async addMembers(chatId: string, actorId: string, requestedUserIds: string[]) {
    const userIds = [...new Set(requestedUserIds)];
    return this.database.$transaction(
      async (transaction) => {
        const group = await this.requireGroupAdmin(
          transaction,
          chatId,
          actorId
        );
        const existingIds = new Set(group.members.map((member) => member.userId));
        if (userIds.some((userId) => existingIds.has(userId))) {
          throw new AppError(409, "One or more users are already group members");
        }

        const users = await transaction.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true },
        });
        if (users.length !== userIds.length) {
          throw new AppError(404, "One or more users not found");
        }

        await transaction.chatMember.createMany({
          data: userIds.map((userId) => ({
            chatId,
            userId,
            role: ChatMemberRole.MEMBER,
          })),
        });
        return this.requireGroupMember(transaction, chatId, actorId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async removeMember(chatId: string, actorId: string, targetUserId: string) {
    return this.database.$transaction(
      async (transaction) => {
        const group = await this.requireGroupMember(
          transaction,
          chatId,
          actorId
        );
        const actor = group.members.find((member) => member.userId === actorId);
        const target = group.members.find(
          (member) => member.userId === targetUserId
        );
        if (!target) throw new AppError(404, "Group member not found");
        if (actorId !== targetUserId && actor?.role !== ChatMemberRole.ADMIN) {
          throw new AppError(403, "Only group admins can remove other members");
        }

        if (target.role === ChatMemberRole.ADMIN) {
          const adminCount = await transaction.chatMember.count({
            where: { chatId, role: ChatMemberRole.ADMIN },
          });
          if (adminCount <= 1) {
            throw new AppError(
              409,
              "The last group admin cannot leave or be removed"
            );
          }
        }

        await transaction.chatMember.delete({
          where: { chatId_userId: { chatId, userId: targetUserId } },
        });
        return { chatId, userId: targetUserId, removed: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async updateMemberRole(
    chatId: string,
    actorId: string,
    targetUserId: string,
    role: ChatMemberRole
  ) {
    return this.database.$transaction(
      async (transaction) => {
        const group = await this.requireGroupAdmin(
          transaction,
          chatId,
          actorId
        );
        const target = group.members.find(
          (member) => member.userId === targetUserId
        );
        if (!target) throw new AppError(404, "Group member not found");

        if (
          target.role === ChatMemberRole.ADMIN &&
          role === ChatMemberRole.MEMBER
        ) {
          const adminCount = await transaction.chatMember.count({
            where: { chatId, role: ChatMemberRole.ADMIN },
          });
          if (adminCount <= 1) {
            throw new AppError(409, "The last group admin cannot be demoted");
          }
        }

        await transaction.chatMember.update({
          where: { chatId_userId: { chatId, userId: targetUserId } },
          data: { role },
        });
        return this.requireGroupMember(transaction, chatId, actorId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private async requireGroupAdmin(
    database: Pick<Prisma.TransactionClient, "chat">,
    chatId: string,
    userId: string
  ) {
    const group = await this.requireGroupMember(database, chatId, userId);
    const member = group.members.find((entry) => entry.userId === userId);
    if (member?.role !== ChatMemberRole.ADMIN) {
      throw new AppError(403, "Only group admins can perform this action");
    }
    return group;
  }

  private async requireGroupMember(
    database: Pick<Prisma.TransactionClient, "chat">,
    chatId: string,
    userId: string
  ) {
    const chat = await database.chat.findUnique({
      where: { id: chatId },
      include: {
        members: {
          select: { userId: true, role: true, joinedAt: true },
          orderBy: { joinedAt: "asc" },
        },
      },
    });
    if (!chat) throw new AppError(404, "Group not found");
    if (chat.type !== ChatType.GROUP) {
      throw new AppError(400, "This operation is only available for group chats");
    }
    if (!chat.members.some((member) => member.userId === userId)) {
      throw new AppError(403, "User is not a member of this group");
    }
    return chat;
  }
}
