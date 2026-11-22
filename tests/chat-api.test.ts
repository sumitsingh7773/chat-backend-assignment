import request from "supertest";
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app";

const member = { id: "membership-1" };
const messages = new Map<string, Record<string, unknown>>();
const lastSeenRecords = new Map<string, Record<string, unknown>>();

function makeFirestore() {
  let cursorId: string | undefined;
  let pageLimit = Number.POSITIVE_INFINITY;
  const query: {
    orderBy: jest.Mock;
    startAfter: jest.Mock;
    limit: jest.Mock;
    get: jest.Mock;
  } = {
    orderBy: jest.fn(),
    startAfter: jest.fn(),
    limit: jest.fn(),
    get: jest.fn(),
  };
  query.orderBy.mockReturnValue(query);
  query.startAfter.mockImplementation((snapshot: { id: string }) => {
    cursorId = snapshot.id;
    return query;
  });
  query.limit.mockImplementation((limit: number) => {
    pageLimit = limit;
    return query;
  });
  query.get.mockImplementation(async () => ({
    docs: (() => {
      const sorted = [...messages.entries()]
        .sort(([, left], [, right]) => {
          const leftTime = (left.createdAt as Timestamp).toMillis();
          const rightTime = (right.createdAt as Timestamp).toMillis();
          return rightTime - leftTime;
        })
        .map(([id, data]) => ({
        id,
        data: () => data,
        }));
      const cursorIndex = cursorId
        ? sorted.findIndex((document) => document.id === cursorId)
        : -1;
      return sorted.slice(cursorIndex + 1, cursorIndex + 1 + pageLimit);
    })(),
  }));

  const collection = {
    orderBy: query.orderBy,
    doc: jest.fn((chatId: string) => ({
      collection: jest.fn((collectionName: string) => ({
        orderBy: query.orderBy,
        doc: jest.fn((documentId: string) => {
          const recordKey = `${chatId}/${documentId}`;
          return {
            get: jest.fn(async () => ({
              exists:
                collectionName === "messages"
                  ? messages.has(documentId)
                  : lastSeenRecords.has(recordKey),
              id: documentId,
              data: () =>
                collectionName === "messages"
                  ? messages.get(documentId)
                  : lastSeenRecords.get(recordKey),
            })),
            update: jest.fn(async (value: Record<string, unknown>) => {
              const existing = messages.get(documentId);
              if (existing) messages.set(documentId, { ...existing, ...value });
            }),
            set: jest.fn(async (value: Record<string, unknown>) => {
              lastSeenRecords.set(recordKey, value);
            }),
          };
        }),
        add: jest.fn(async (data: Record<string, unknown>) => {
          const id = `message-${messages.size + 1}`;
          messages.set(id, { ...data, chatId });
          return { id };
        }),
      })),
    })),
  };

  return {
    firestore: { collection: jest.fn(() => collection) } as unknown as Firestore,
    query,
  };
}

describe("chat API", () => {
  const database = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    chat: { upsert: jest.fn() },
    chatMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaClient;
  const db = database as unknown as {
    user: { findMany: jest.Mock; findUnique: jest.Mock };
    chat: { upsert: jest.Mock };
    chatMember: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };
  const { firestore, query } = makeFirestore();
  const app = createApp(database, () => firestore, async (token) => token);

  beforeEach(() => {
    jest.clearAllMocks();
    messages.clear();
    lastSeenRecords.clear();
    db.user.findMany.mockResolvedValue([{ id: "alice" }, { id: "bob" }]);
    db.user.findUnique.mockResolvedValue({ id: "alice" });
    db.chat.upsert.mockResolvedValue({
      id: "chat-1",
      members: [{ userId: "alice" }, { userId: "bob" }],
    });
    db.chatMember.findUnique.mockResolvedValue(member);
    db.chatMember.findMany.mockResolvedValue([
      {
        lastSeenAt: null,
        chat: {
          id: "chat-1",
          members: [{ userId: "alice" }, { userId: "bob" }],
        },
      },
    ]);
  });

  it("serves the health endpoint and Swagger UI before the not-found handler", async () => {
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      success: true,
      message: "Chat Backend API is running",
    });
    expect(typeof health.body.timestamp).toBe("string");

    const docs = await request(app).get("/api-docs/");
    expect(docs.status).toBe(200);
    expect(docs.text).toContain("swagger-ui");

    const docsConfig = await request(app).get("/api-docs/swagger-ui-init.js");
    expect(docsConfig.status).toBe(200);
    expect(docsConfig.text).toContain("BearerAuth");
    expect(docsConfig.text).toContain("/api/chats/{chatId}/messages");
    expect(docsConfig.text).toContain("/chat/create");
    expect(docsConfig.text).toContain("/chat/{chatId}/message/send");
    expect(docsConfig.text).toContain("/user/{userId}/chats");
  });

  it("requires a bearer token and rejects invalid Firebase tokens", async () => {
    const unauthenticated = await request(app)
      .post("/api/chats")
      .send({ otherUserId: "bob" });
    expect(unauthenticated.status).toBe(401);

    const invalidApp = createApp(database, () => firestore, async () => {
      throw { code: "auth/invalid-id-token" };
    });
    const invalidToken = await request(invalidApp)
      .post("/api/chats")
      .set("Authorization", "Bearer invalid")
      .send({ otherUserId: "bob" });
    expect(invalidToken.status).toBe(401);
  });

  it("uses the verified token UID rather than a client-supplied user ID", async () => {
    const response = await request(app)
      .post("/api/chats")
      .set("Authorization", "Bearer alice")
      .send({ userId: "bob", otherUserId: "taylor" });

    expect(response.status).toBe(400);
    expect(db.chat.upsert).not.toHaveBeenCalled();
  });

  it("creates or returns the unique one-to-one chat using a canonical pair key", async () => {
    const response = await request(app)
      .post("/api/chats")
      .set("Authorization", "Bearer bob")
      .send({ otherUserId: "alice" });

    expect(response.status).toBe(200);
    expect(db.chat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pairKey: '["alice","bob"]' },
        create: expect.objectContaining({
          members: { create: [{ userId: "bob" }, { userId: "alice" }] },
        }),
      })
    );

    await request(app)
      .post("/api/chats")
      .set("Authorization", "Bearer alice")
      .send({ otherUserId: "bob" });
    expect(db.chat.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { pairKey: '["alice","bob"]' },
      })
    );
  });

  it("supports all six assignment-compatible route aliases", async () => {
    const createChat = await request(app)
      .post("/chat/create")
      .set("Authorization", "Bearer alice")
      .send({ userAId: "alice", userBId: "bob" });
    expect(createChat.status).toBe(200);
    expect(createChat.body.data.id).toBe("chat-1");

    const sendMessage = await request(app)
      .post("/chat/chat-1/message/send")
      .set("Authorization", "Bearer alice")
      .send({ senderId: "alice", text: "Assignment route message" });
    expect(sendMessage.status).toBe(201);
    expect(sendMessage.body.data).toMatchObject({
      senderId: "alice",
      content: "Assignment route message",
      text: "Assignment route message",
    });
    const messageId = sendMessage.body.data.id as string;

    const getMessages = await request(app)
      .get("/chat/chat-1/messages?userId=alice&limit=5")
      .set("Authorization", "Bearer alice");
    expect(getMessages.status).toBe(200);
    expect(getMessages.body.data.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: messageId,
          senderId: "alice",
          text: "Assignment route message",
        }),
      ])
    );

    const markRead = await request(app)
      .post(`/chat/chat-1/message/${messageId}/read`)
      .set("Authorization", "Bearer alice")
      .send({ userId: "alice" });
    expect(markRead.status).toBe(200);
    expect(markRead.body.data).toMatchObject({ messageId, userId: "alice", read: true });

    const lastSeen = await request(app)
      .post("/chat/chat-1/lastseen")
      .set("Authorization", "Bearer alice")
      .send({ userId: "alice", messageId });
    expect(lastSeen.status).toBe(200);
    expect(lastSeen.body.data).toMatchObject({
      chatId: "chat-1",
      userId: "alice",
      messageId,
    });

    const listChats = await request(app)
      .get("/user/alice/chats")
      .set("Authorization", "Bearer alice");
    expect(listChats.status).toBe(200);
    expect(listChats.body.data[0].memberIds).toEqual(["alice", "bob"]);
  });

  it("rejects assignment alias identity fields that differ from the verified token", async () => {
    const createChat = await request(app)
      .post("/chat/create")
      .set("Authorization", "Bearer alice")
      .send({ userAId: "bob", userBId: "alice" });
    expect(createChat.status).toBe(403);

    const sendMessage = await request(app)
      .post("/chat/chat-1/message/send")
      .set("Authorization", "Bearer alice")
      .send({ senderId: "bob", text: "Spoofed sender" });
    expect(sendMessage.status).toBe(403);

    const getMessages = await request(app)
      .get("/chat/chat-1/messages?userId=bob")
      .set("Authorization", "Bearer alice");
    expect(getMessages.status).toBe(403);

    const markRead = await request(app)
      .post("/chat/chat-1/message/message-1/read")
      .set("Authorization", "Bearer alice")
      .send({ userId: "bob" });
    expect(markRead.status).toBe(403);

    const lastSeen = await request(app)
      .post("/chat/chat-1/lastseen")
      .set("Authorization", "Bearer alice")
      .send({ userId: "bob", messageId: "message-1" });
    expect(lastSeen.status).toBe(403);

    const listChats = await request(app)
      .get("/user/bob/chats")
      .set("Authorization", "Bearer alice");
    expect(listChats.status).toBe(403);
  });

  it("rejects self chats and unknown users", async () => {
    const selfChat = await request(app)
      .post("/api/chats")
      .set("Authorization", "Bearer alice")
      .send({ otherUserId: "alice" });
    expect(selfChat.status).toBe(400);

    db.user.findMany.mockResolvedValueOnce([{ id: "alice" }]);
    const missingUser = await request(app)
      .post("/api/chats")
      .set("Authorization", "Bearer alice")
      .send({ otherUserId: "missing" });
    expect(missingUser.status).toBe(404);
  });

  it("sends a message to Firestore only for chat members", async () => {
    const response = await request(app)
      .post("/api/chats/chat-1/messages")
      .set("Authorization", "Bearer alice")
      .send({ content: "Hello" });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      id: "message-1",
      senderId: "alice",
      content: "Hello",
      readBy: ["alice"],
    });

    db.chatMember.findUnique.mockResolvedValueOnce(null);
    const forbidden = await request(app)
      .post("/api/chats/chat-1/messages")
      .set("Authorization", "Bearer eve")
      .send({ content: "Intrusion" });
    expect(forbidden.status).toBe(403);
  });

  it("returns ordered, cursor-paginated messages", async () => {
    messages.set("older", { createdAt: Timestamp.fromDate(new Date(1)), content: "old" });
    messages.set("newer", { createdAt: Timestamp.fromDate(new Date(2)), content: "new" });

    const firstPage = await request(app)
      .get("/api/chats/chat-1/messages?limit=1")
      .set("Authorization", "Bearer alice");

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.messages).toHaveLength(1);
    expect(firstPage.body.data.messages[0].id).toBe("newer");
    expect(firstPage.body.data.nextCursor).toBe("newer");
    expect(query.orderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(query.orderBy).toHaveBeenCalledTimes(2);

    const secondPage = await request(app)
      .get("/api/chats/chat-1/messages?limit=1&cursor=newer")
      .set("Authorization", "Bearer alice");
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data.messages[0].id).toBe("older");
    expect(secondPage.body.data.nextCursor).toBeNull();
    expect(query.startAfter).toHaveBeenCalled();

    const invalidCursor = await request(app)
      .get("/api/chats/chat-1/messages?cursor=unknown")
      .set("Authorization", "Bearer alice");
    expect(invalidCursor.status).toBe(400);

    const spoofedQuery = await request(app)
      .get("/api/chats/chat-1/messages?userId=bob")
      .set("Authorization", "Bearer alice");
    expect(spoofedQuery.status).toBe(400);
  });

  it("records read receipts for members and rejects non-members", async () => {
    messages.set("message-1", { senderId: "bob", readBy: ["bob"] });

    const response = await request(app)
      .patch("/api/chats/chat-1/messages/message-1/read")
      .set("Authorization", "Bearer alice");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ read: true, userId: "alice" });

    db.chatMember.findUnique.mockResolvedValueOnce(null);
    const forbidden = await request(app)
      .patch("/api/chats/chat-1/messages/message-1/read")
      .set("Authorization", "Bearer eve");
    expect(forbidden.status).toBe(403);

    const missingMessage = await request(app)
      .patch("/api/chats/chat-1/messages/missing/read")
      .set("Authorization", "Bearer alice");
    expect(missingMessage.status).toBe(404);
  });

  it("stores the authenticated member's last-seen message in Firestore", async () => {
    messages.set("message-1", {
      senderId: "bob",
      content: "Hello",
      createdAt: Timestamp.fromDate(new Date(1)),
      readBy: ["bob"],
    });

    const lastSeen = await request(app)
      .patch("/api/chats/chat-1/last-seen")
      .set("Authorization", "Bearer alice")
      .send({ messageId: "message-1" });
    expect(lastSeen.status).toBe(200);
    expect(lastSeen.body.data).toMatchObject({
      chatId: "chat-1",
      userId: "alice",
      messageId: "message-1",
    });
    expect(db.chatMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chatId_userId: { chatId: "chat-1", userId: "alice" } },
      })
    );
    expect(db.chatMember.update).not.toHaveBeenCalled();
    expect(lastSeenRecords.get("chat-1/alice")).toMatchObject({
      messageId: "message-1",
      updatedAt: expect.any(Timestamp),
    });
    expect(typeof lastSeen.body.data.updatedAt).toBe("string");

    const spoofedUser = await request(app)
      .patch("/api/chats/chat-1/last-seen")
      .set("Authorization", "Bearer alice")
      .send({ messageId: "message-1", userId: "bob" });
    expect(spoofedUser.status).toBe(400);

    const missingMessage = await request(app)
      .patch("/api/chats/chat-1/last-seen")
      .set("Authorization", "Bearer alice")
      .send({ messageId: "missing" });
    expect(missingMessage.status).toBe(404);

    db.chatMember.findUnique.mockResolvedValueOnce(null);
    const nonMember = await request(app)
      .patch("/api/chats/chat-1/last-seen")
      .set("Authorization", "Bearer alice")
      .send({ messageId: "message-1" });
    expect(nonMember.status).toBe(403);
    expect(lastSeenRecords.has("chat-1/bob")).toBe(false);
  });

  it("lists chat member IDs from PostgreSQL", async () => {
    const chats = await request(app)
      .get("/api/users/alice/chats")
      .set("Authorization", "Bearer alice");
    expect(chats.status).toBe(200);
    expect(chats.body.data[0].memberIds).toEqual(["alice", "bob"]);

    const otherChats = await request(app)
      .get("/api/users/bob/chats")
      .set("Authorization", "Bearer alice");
    expect(otherChats.status).toBe(403);
  });

  it("validates request bodies and parameters", async () => {
    const response = await request(app)
      .post("/api/chats/chat-1/messages")
      .set("Authorization", "Bearer alice")
      .send({ content: " " });
    expect(response.status).toBe(400);

    const invalidJson = await request(app)
      .post("/api/chats")
      .set("Authorization", "Bearer alice")
      .set("Content-Type", "application/json")
      .send('{"otherUserId":');
    expect(invalidJson.status).toBe(400);

    const missingLastSeenMessageId = await request(app)
      .patch("/api/chats/chat-1/last-seen")
      .set("Authorization", "Bearer alice")
      .send({});
    expect(missingLastSeenMessageId.status).toBe(400);

    const missingRoute = await request(app).get("/missing");
    expect(missingRoute.status).toBe(404);
  });
});
