import request from "supertest";
import { Firestore } from "firebase-admin/firestore";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app";

describe("group chat API", () => {
  const database = {
    user: { findMany: jest.fn() },
    chat: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    chatMember: {
      createMany: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(
      async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation(database)
    ),
  } as unknown as PrismaClient;
  const db = database as unknown as {
    user: { findMany: jest.Mock };
    chat: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    chatMember: {
      createMany: jest.Mock;
      delete: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  const app = createApp(
    database,
    () => ({}) as Firestore,
    async (token) => token
  );
  const knownUsers = ["admin", "member", "new-member"];

  const group = (
    members: Array<{ userId: string; role: "ADMIN" | "MEMBER" }>
  ) => ({
    id: "group-1",
    type: "GROUP",
    name: "Study group",
    description: null,
    members: members.map((entry) => ({
      ...entry,
      joinedAt: new Date("2026-01-01T00:00:00Z"),
    })),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    db.user.findMany.mockImplementation(
      async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in
          .filter((userId) => knownUsers.includes(userId))
          .map((id) => ({ id }))
    );
    db.chat.create.mockResolvedValue(
      group([
        { userId: "admin", role: "ADMIN" },
        { userId: "member", role: "MEMBER" },
      ])
    );
    db.chat.findUnique.mockResolvedValue(
      group([
        { userId: "admin", role: "ADMIN" },
        { userId: "member", role: "MEMBER" },
      ])
    );
    db.chatMember.count.mockResolvedValue(1);
  });

  it("creates a group with its creator as admin and members as regular users", async () => {
    const response = await request(app)
      .post("/api/groups")
      .set("Authorization", "Bearer admin")
      .send({
        name: "Study group",
        description: "Shared notes",
        memberIds: ["member", "member", "admin"],
      });

    expect(response.status).toBe(201);
    expect(db.chat.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "GROUP",
          name: "Study group",
          description: "Shared notes",
          members: {
            create: [
              { userId: "admin", role: "ADMIN" },
              { userId: "member", role: "MEMBER" },
            ],
          },
        }),
      })
    );
  });

  it("requires admins for group settings, member changes, and role controls", async () => {
    db.chat.findUnique.mockResolvedValueOnce(
      group([
        { userId: "admin", role: "ADMIN" },
        { userId: "member", role: "MEMBER" },
      ])
    );
    const update = await request(app)
      .patch("/api/groups/group-1")
      .set("Authorization", "Bearer member")
      .send({ name: "Renamed" });
    expect(update.status).toBe(403);

    db.chat.findUnique.mockResolvedValueOnce(
      group([
        { userId: "admin", role: "ADMIN" },
        { userId: "member", role: "MEMBER" },
      ])
    );
    const add = await request(app)
      .post("/api/groups/group-1/members")
      .set("Authorization", "Bearer member")
      .send({ userIds: ["new-member"] });
    expect(add.status).toBe(403);

    db.chat.findUnique.mockResolvedValueOnce(
      group([
        { userId: "admin", role: "ADMIN" },
        { userId: "member", role: "MEMBER" },
      ])
    );
    const role = await request(app)
      .patch("/api/groups/group-1/members/member/role")
      .set("Authorization", "Bearer member")
      .send({ role: "ADMIN" });
    expect(role.status).toBe(403);
  });

  it("lets an admin add members and grant admin privileges", async () => {
    db.chat.findUnique
      .mockResolvedValueOnce(
        group([
          { userId: "admin", role: "ADMIN" },
          { userId: "member", role: "MEMBER" },
        ])
      )
      .mockResolvedValueOnce(
        group([
          { userId: "admin", role: "ADMIN" },
          { userId: "member", role: "MEMBER" },
          { userId: "new-member", role: "MEMBER" },
        ])
      );
    const add = await request(app)
      .post("/api/groups/group-1/members")
      .set("Authorization", "Bearer admin")
      .send({ userIds: ["new-member"] });
    expect(add.status).toBe(200);
    expect(db.chatMember.createMany).toHaveBeenCalledWith({
      data: [{ chatId: "group-1", userId: "new-member", role: "MEMBER" }],
    });

    db.chat.findUnique
      .mockResolvedValueOnce(
        group([
          { userId: "admin", role: "ADMIN" },
          { userId: "member", role: "MEMBER" },
        ])
      )
      .mockResolvedValueOnce(
        group([
          { userId: "admin", role: "ADMIN" },
          { userId: "member", role: "ADMIN" },
        ])
      );
    const promote = await request(app)
      .patch("/api/groups/group-1/members/member/role")
      .set("Authorization", "Bearer admin")
      .send({ role: "ADMIN" });
    expect(promote.status).toBe(200);
    expect(db.chatMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chatId_userId: { chatId: "group-1", userId: "member" } },
        data: { role: "ADMIN" },
      })
    );
  });

  it("prevents removing or demoting the last group admin", async () => {
    const soleAdmin = group([{ userId: "admin", role: "ADMIN" }]);
    db.chat.findUnique.mockResolvedValueOnce(soleAdmin);
    const remove = await request(app)
      .delete("/api/groups/group-1/members/admin")
      .set("Authorization", "Bearer admin");
    expect(remove.status).toBe(409);

    db.chat.findUnique.mockResolvedValueOnce(soleAdmin);
    const demote = await request(app)
      .patch("/api/groups/group-1/members/admin/role")
      .set("Authorization", "Bearer admin")
      .send({ role: "MEMBER" });
    expect(demote.status).toBe(409);
    expect(db.chatMember.delete).not.toHaveBeenCalled();
    expect(db.chatMember.update).not.toHaveBeenCalled();
  });

  it("keeps a member authorized to leave but not to remove another member", async () => {
    db.chat.findUnique.mockResolvedValueOnce(
      group([
        { userId: "admin", role: "ADMIN" },
        { userId: "member", role: "MEMBER" },
      ])
    );
    const removeOther = await request(app)
      .delete("/api/groups/group-1/members/admin")
      .set("Authorization", "Bearer member");
    expect(removeOther.status).toBe(403);

    db.chat.findUnique.mockResolvedValueOnce(
      group([
        { userId: "admin", role: "ADMIN" },
        { userId: "member", role: "MEMBER" },
      ])
    );
    const leave = await request(app)
      .delete("/api/groups/group-1/members/member")
      .set("Authorization", "Bearer member");
    expect(leave.status).toBe(200);
    expect(db.chatMember.delete).toHaveBeenCalledWith({
      where: { chatId_userId: { chatId: "group-1", userId: "member" } },
    });
  });
});
