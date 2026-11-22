import {
  FieldPath,
  FieldValue,
  Firestore,
  Timestamp,
} from "firebase-admin/firestore";
import { PrismaClient } from "@prisma/client";
import { AppError } from "../errors/app-error";

const messagePageLimit = 100;

export class ChatService {
  constructor(
    private readonly database: PrismaClient,
    private readonly firestoreProvider: () => Firestore
  ) {}

  async getOrCreateOneToOneChat(userId: string, otherUserId: string) {
    if (userId === otherUserId) {
      throw new AppError(400, "A one-to-one chat requires two different users");
    }

    const users = await this.database.user.findMany({
      where: { id: { in: [userId, otherUserId] } },
      select: { id: true },
    });
    if (users.length !== 2) throw new AppError(404, "One or more users not found");

    const pairKey = JSON.stringify([userId, otherUserId].sort());
    return this.database.chat.upsert({
      where: { pairKey },
      update: {},
      create: {
        type: "ONE_TO_ONE",
        pairKey,
        members: {
          create: [{ userId }, { userId: otherUserId }],
        },
      },
      include: { members: { select: { userId: true } } },
    });
  }

  async sendMessage(chatId: string, userId: string, content: string) {
    await this.requireMembership(chatId, userId);

    const createdAt = Timestamp.now();
    const message = {
      senderId: userId,
      content,
      createdAt,
      readBy: [userId],
    };
    const reference = await this.firestoreProvider()
      .collection("chats")
      .doc(chatId)
      .collection("messages")
      .add(message);

    return {
      id: reference.id,
      ...message,
      createdAt: createdAt.toDate().toISOString(),
    };
  }

  async getMessages(
    chatId: string,
    userId: string,
    requestedLimit: number,
    cursor?: string
  ) {
    await this.requireMembership(chatId, userId);
    const limit = Math.min(requestedLimit, messagePageLimit);
    const collection = this.firestoreProvider()
      .collection("chats")
      .doc(chatId)
      .collection("messages");
    let query = collection
      .orderBy("createdAt", "desc")
      .orderBy(FieldPath.documentId(), "desc");

    if (cursor) {
      const cursorSnapshot = await collection.doc(cursor).get();
      if (!cursorSnapshot.exists) throw new AppError(400, "Invalid message cursor");
      query = query.startAfter(cursorSnapshot);
    }

    const snapshot = await query.limit(limit + 1).get();
    const hasMore = snapshot.docs.length > limit;
    const messages = snapshot.docs.slice(0, limit).map((document) => {
      const data = document.data();
      return {
        id: document.id,
        ...data,
        createdAt:
          data.createdAt instanceof Timestamp
            ? data.createdAt.toDate().toISOString()
            : data.createdAt,
      };
    });

    return {
      messages,
      nextCursor: hasMore ? messages[messages.length - 1]?.id ?? null : null,
    };
  }

  async markMessageRead(chatId: string, messageId: string, userId: string) {
    await this.requireMembership(chatId, userId);
    const reference = this.firestoreProvider()
      .collection("chats")
      .doc(chatId)
      .collection("messages")
      .doc(messageId);

    if (!(await reference.get()).exists) throw new AppError(404, "Message not found");
    await reference.update({ readBy: FieldValue.arrayUnion(userId) });
    return { messageId, userId, read: true };
  }

  async updateLastSeen(chatId: string, userId: string, messageId: string) {
    await this.requireMembership(chatId, userId);

    const chat = this.firestoreProvider().collection("chats").doc(chatId);
    const message = await chat.collection("messages").doc(messageId).get();
    if (!message.exists) throw new AppError(404, "Message not found");

    const updatedAt = Timestamp.now();
    await chat.collection("lastSeen").doc(userId).set({ messageId, updatedAt });
    return { chatId, userId, messageId, updatedAt: updatedAt.toDate().toISOString() };
  }

  private async requireMembership(chatId: string, userId: string) {
    const membership = await this.database.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { id: true },
    });
    if (!membership) throw new AppError(403, "User is not a member of this chat");
  }
}
