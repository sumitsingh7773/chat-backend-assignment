import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, UserRecord } from "firebase-admin/auth";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import request from "supertest";
import { createApp } from "../src/app";
import { getFirestoreClient } from "../src/config/firebase";

const prisma = new PrismaClient();
const runId = randomUUID();
const firebaseUsers: UserRecord[] = [];
const postgresUserIds: string[] = [];
let groupId: string | undefined;
let cleanupFailed = false;
let authCleanupFailed = false;
let auth: ReturnType<typeof getAuth> | undefined;
let firestore: Firestore | undefined;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function report(name: string, passed: boolean) {
  console.log(`${name}=${passed ? "PASS" : "FAIL"}`);
  if (!passed) process.exitCode = 1;
}

async function createAuthenticatedUser(
  auth: ReturnType<typeof getAuth>,
  apiKey: string,
  password: string,
  label: string
) {
  const email = `group-e2e-${label}-${runId}@example.com`;
  const user = await auth.createUser({
    email,
    password,
    displayName: `Temporary group E2E ${label}`,
  });
  firebaseUsers.push(user);
  await prisma.user.create({
    data: { id: user.uid, email, name: `Temporary group E2E ${label}` },
  });
  postgresUserIds.push(user.uid);

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    }
  );
  const payload: { idToken?: string; localId?: string } = await response.json();
  assert(response.ok && payload.idToken, "Firebase did not issue an ID token");
  assert(payload.localId === user.uid, "Firebase token UID did not match test user");
  return { user, token: payload.idToken };
}

async function expectStatus(
  name: string,
  response: request.Response,
  status: number
) {
  assert(
    response.status === status,
    `${name} returned HTTP ${response.status}, expected ${status}`
  );
  report(name, true);
}

async function main() {
  try {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const password = process.env.FIREBASE_TEST_PASSWORD;
  const credentialPath = path.resolve(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ??
      "credentials/firebase-service-account.json"
  );
  assert(apiKey, "FIREBASE_WEB_API_KEY is required for live integration tests");
  assert(password, "FIREBASE_TEST_PASSWORD is required for live integration tests");

  const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf8"));
  const firebaseApp =
    getApps()[0] ??
    initializeApp({
      credential: cert(serviceAccount),
    });
  auth = getAuth(firebaseApp);
  firestore = getFirestore(firebaseApp);
  const app = createApp(prisma, getFirestoreClient);
  const adminUser = await createAuthenticatedUser(auth, apiKey, password, "admin");
  const memberUser = await createAuthenticatedUser(auth, apiKey, password, "member");
  const addedUser = await createAuthenticatedUser(auth, apiKey, password, "added");
  const outsiderUser = await createAuthenticatedUser(auth, apiKey, password, "outsider");

    const unauthenticated = await request(app)
      .post("/api/groups")
      .send({ name: "unauthenticated" });
    await expectStatus("GROUP_AUTH_REQUIRED", unauthenticated, 401);

    const created = await request(app)
      .post("/api/groups")
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({
        name: `Group ${runId}`,
        description: "Temporary live integration group",
        memberIds: [memberUser.user.uid],
      });
    await expectStatus("GROUP_CREATE", created, 201);
    groupId = created.body.data.id as string;
    assert(groupId, "Group create response did not contain an ID");
    const createdGroup = await prisma.chat.findUnique({
      where: { id: groupId },
      include: { members: true },
    });
    assert(createdGroup?.type === "GROUP", "Group type was not persisted");
    assert(
      createdGroup.name === `Group ${runId}` &&
        createdGroup.members.some(
          (entry) =>
            entry.userId === adminUser.user.uid && entry.role === "ADMIN"
        ) &&
        createdGroup.members.some(
          (entry) =>
            entry.userId === memberUser.user.uid && entry.role === "MEMBER"
        ),
      "Group name, admin, or initial member was not persisted"
    );
    report("POSTGRES_GROUP_AND_ROLES_PERSISTED", true);

    const memberCannotRename = await request(app)
      .patch(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${memberUser.token}`)
      .send({ name: "Unauthorized rename" });
    await expectStatus("GROUP_MEMBER_CANNOT_RENAME", memberCannotRename, 403);

    const memberCannotAdd = await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${memberUser.token}`)
      .send({ userIds: [addedUser.user.uid] });
    await expectStatus("GROUP_MEMBER_CANNOT_ADD_MEMBERS", memberCannotAdd, 403);

    const outsiderCannotRead = await request(app)
      .get(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${outsiderUser.token}`);
    await expectStatus("GROUP_OUTSIDER_CANNOT_READ", outsiderCannotRead, 403);

    const renamed = await request(app)
      .patch(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ name: `Renamed ${runId}` });
    await expectStatus("GROUP_ADMIN_RENAME", renamed, 200);

    const added = await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ userIds: [addedUser.user.uid] });
    await expectStatus("GROUP_ADMIN_ADD_MEMBER", added, 200);
    assert(
      await prisma.chatMember.findUnique({
        where: {
          chatId_userId: { chatId: groupId, userId: addedUser.user.uid },
        },
      }),
      "Added member was not persisted in PostgreSQL"
    );
    report("POSTGRES_ADDED_MEMBER_PERSISTED", true);

    const sent = await request(app)
      .post(`/api/groups/${groupId}/messages`)
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ content: `Group message ${runId}` });
    await expectStatus("GROUP_SEND_MESSAGE", sent, 201);
    const messageId = sent.body.data.id as string;
    const storedMessage = await firestore
      .collection("chats")
      .doc(groupId)
      .collection("messages")
      .doc(messageId)
      .get();
    assert(
      storedMessage.exists &&
        storedMessage.get("senderId") === adminUser.user.uid &&
        storedMessage.get("content") === `Group message ${runId}`,
      "Group message was not persisted in Firestore"
    );
    report("FIRESTORE_GROUP_MESSAGE_PERSISTED", true);

    const fetched = await request(app)
      .get(`/api/groups/${groupId}/messages?limit=10`)
      .set("Authorization", `Bearer ${memberUser.token}`);
    await expectStatus("GROUP_FETCH_MESSAGES", fetched, 200);
    assert(
      fetched.body.data.messages.some(
        (message: { id: string }) => message.id === messageId
      ),
      "Group message is missing for another member"
    );

    const read = await request(app)
      .patch(`/api/chats/${groupId}/messages/${messageId}/read`)
      .set("Authorization", `Bearer ${memberUser.token}`);
    await expectStatus("GROUP_MARK_READ", read, 200);
    const readMessage = await firestore
      .collection("chats")
      .doc(groupId)
      .collection("messages")
      .doc(messageId)
      .get();
    assert(
      readMessage.get("readBy").includes(memberUser.user.uid),
      "Group member's read receipt was not persisted"
    );
    report("FIRESTORE_PER_MEMBER_READ_RECEIPT", true);

    const lastSeen = await request(app)
      .patch(`/api/chats/${groupId}/last-seen`)
      .set("Authorization", `Bearer ${memberUser.token}`)
      .send({ messageId });
    await expectStatus("GROUP_UPDATE_LAST_SEEN", lastSeen, 200);
    const storedLastSeen = await firestore
      .collection("chats")
      .doc(groupId)
      .collection("lastSeen")
      .doc(memberUser.user.uid)
      .get();
    assert(
      storedLastSeen.exists &&
        storedLastSeen.get("messageId") === messageId &&
        storedLastSeen.get("updatedAt"),
      "Group member's last-seen record was not persisted"
    );
    report("FIRESTORE_PER_MEMBER_LAST_SEEN", true);

    const promoted = await request(app)
      .patch(`/api/groups/${groupId}/members/${addedUser.user.uid}/role`)
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ role: "ADMIN" });
    await expectStatus("GROUP_PROMOTE_ADMIN", promoted, 200);
    const promotedMember = await prisma.chatMember.findUnique({
      where: {
        chatId_userId: { chatId: groupId, userId: addedUser.user.uid },
      },
    });
    assert(promotedMember?.role === "ADMIN", "Admin role was not persisted");
    report("POSTGRES_ADMIN_ROLE_PERSISTED", true);

    const demoted = await request(app)
      .patch(`/api/groups/${groupId}/members/${addedUser.user.uid}/role`)
      .set("Authorization", `Bearer ${adminUser.token}`)
      .send({ role: "MEMBER" });
    await expectStatus("GROUP_DEMOTE_ADMIN", demoted, 200);

    const removed = await request(app)
      .delete(`/api/groups/${groupId}/members/${addedUser.user.uid}`)
      .set("Authorization", `Bearer ${adminUser.token}`);
    await expectStatus("GROUP_ADMIN_REMOVE_MEMBER", removed, 200);
    assert(
      !(await prisma.chatMember.findUnique({
        where: {
          chatId_userId: { chatId: groupId, userId: addedUser.user.uid },
        },
      })),
      "Removed group member remains in PostgreSQL"
    );
    report("POSTGRES_MEMBER_REMOVAL_PERSISTED", true);

    console.log("GROUP_CHAT_REAL_INTEGRATION=PASS");
  } catch (error) {
    console.error(
      "GROUP_CHAT_REAL_INTEGRATION=FAIL",
      error instanceof Error ? error.message : "Unknown integration failure"
    );
    process.exitCode = 1;
  } finally {
    if (groupId && firestore) {
      const chatDocument = firestore.collection("chats").doc(groupId);
      try {
        for (const collectionName of ["messages", "lastSeen"]) {
          const snapshot = await chatDocument.collection(collectionName).get();
          for (const document of snapshot.docs) await document.ref.delete();
        }
        await chatDocument.delete();
        console.log("GROUP_E2E_FIRESTORE_CLEANUP=PASS");
      } catch {
        console.log("GROUP_E2E_FIRESTORE_CLEANUP=FAIL");
        cleanupFailed = true;
      }
      try {
        await prisma.chat.deleteMany({ where: { id: groupId } });
        console.log("GROUP_E2E_POSTGRES_CHAT_CLEANUP=PASS");
      } catch {
        console.log("GROUP_E2E_POSTGRES_CHAT_CLEANUP=FAIL");
        cleanupFailed = true;
      }
    }

    try {
      await prisma.user.deleteMany({ where: { id: { in: postgresUserIds } } });
      console.log("GROUP_E2E_POSTGRES_USERS_CLEANUP=PASS");
    } catch {
      console.log("GROUP_E2E_POSTGRES_USERS_CLEANUP=FAIL");
      cleanupFailed = true;
    }

    if (auth) {
      for (const user of firebaseUsers) {
        try {
          await auth.deleteUser(user.uid);
        } catch {
          authCleanupFailed = true;
        }
      }
      if (authCleanupFailed) {
        console.log("GROUP_E2E_FIREBASE_USERS_CLEANUP=FAIL");
        cleanupFailed = true;
      } else {
        console.log("GROUP_E2E_FIREBASE_USERS_CLEANUP=PASS");
      }
    } else if (firebaseUsers.length > 0) {
      cleanupFailed = true;
      console.log("GROUP_E2E_FIREBASE_USERS_CLEANUP=FAIL");
    }
    await prisma.$disconnect();
    if (cleanupFailed) process.exitCode = 1;
  }
}

void main();
