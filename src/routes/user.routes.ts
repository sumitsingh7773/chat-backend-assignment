import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const userIdParams = z.object({ userId: z.string().trim().min(1).max(128) });

export function createUserRouter(database: PrismaClient) {
  const router = Router();

  router.get("/:userId/chats", async (req, res) => {
    const { userId } = userIdParams.parse(req.params);
    if (userId !== res.locals.userId) {
      res.status(403).json({
        success: false,
        error: { message: "Users may only list their own chats" },
      });
      return;
    }

    const user = await database.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      res.status(404).json({
        success: false,
        error: { message: "User not found" },
      });
      return;
    }

    const memberships = await database.chatMember.findMany({
      where: { userId },
      orderBy: { chat: { updatedAt: "desc" } },
      include: {
        chat: {
          include: { members: { select: { userId: true } } },
        },
      },
    });
    res.status(200).json({
      success: true,
      data: memberships.map(({ chat }) => ({
        ...chat,
        memberIds: chat.members.map((member) => member.userId),
      })),
    });
  });

  return router;
}
