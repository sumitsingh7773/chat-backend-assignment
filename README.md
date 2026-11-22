# Chat Backend

Express 5 / TypeScript API with PostgreSQL (Prisma 6) for users and chat membership, and Firebase Firestore for chat messages and read receipts.

## Setup

1. Install Node.js and PostgreSQL, create a database, and configure a Firebase project with Firebase Authentication and Firestore enabled.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`. Point `FIREBASE_SERVICE_ACCOUNT_PATH` to a service account file for the same Firebase project. Keep credentials outside version control; the default local path under `credentials/` is ignored.
3. Install dependencies, generate the Prisma client, apply migrations, and seed demo PostgreSQL users:

   ```sh
   npm install
   npx prisma generate
   npx prisma migrate deploy
   npm run db:seed
   ```

4. Start the API:

   ```sh
   npm run dev
   ```

   The API listens on the port configured by `PORT` (3000 by default). `GET /health` checks availability; interactive Swagger documentation is available at `/api-docs`.

The demo users are `demo-user-alex`, `demo-user-jamie`, and `demo-user-taylor`. Create corresponding Firebase Authentication users whose UIDs exactly match these PostgreSQL user IDs.

## API

All responses use `{ "success": true, "data": ... }` on success and a consistent `error` object on failures.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/chats` | Create or get a unique 1-to-1 chat. JSON: `{ "otherUserId": "..." }`. |
| `POST` | `/api/chats/:chatId/messages` | Send a message. JSON: `{ "content": "..." }`. |
| `GET` | `/api/chats/:chatId/messages?limit=50&cursor=...` | Get messages newest-first; `nextCursor` is the last returned message ID when another page exists. |
| `PATCH` | `/api/chats/:chatId/messages/:messageId/read` | Add the authenticated member to the message's read receipts. |
| `PATCH` | `/api/chats/:chatId/last-seen` | Store the authenticated member's last-seen message and timestamp in Firestore. JSON: `{ "messageId": "..." }`. |
| `GET` | `/api/users/:userId/chats` | List the authenticated user's PostgreSQL chats and their member IDs. |

### Group chats

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/groups` | Create a group with `{ "name": "...", "description": "...", "memberIds": ["..."] }`. The authenticated creator is the first admin. |
| `GET` | `/api/groups/:chatId` | Get group details and member roles. |
| `PATCH` | `/api/groups/:chatId` | Admin-only group name/description update. |
| `POST` | `/api/groups/:chatId/members` | Admin-only add with `{ "userIds": ["..."] }`. |
| `DELETE` | `/api/groups/:chatId/members/:userId` | Admin removes a member; any member may leave. The last admin cannot leave or be removed. |
| `PATCH` | `/api/groups/:chatId/members/:userId/role` | Admin-only role change with `{ "role": "ADMIN" }` or `{ "role": "MEMBER" }`. The last admin cannot be demoted. |
| `POST` | `/api/groups/:chatId/messages` | Send a Firestore message as a group member. JSON: `{ "content": "..." }`. |
| `GET` | `/api/groups/:chatId/messages?limit=50&cursor=...` | Fetch group messages newest-first with cursor pagination. |

Group messages use the same Firestore `chats/{chatId}/messages/{messageId}` collection, `readBy` receipts, and per-user Firestore last-seen documents as 1-to-1 chats. Existing `/api/chats` and assignment-compatible routes remain available; their PostgreSQL membership authorization works for groups as well.

### Assignment-compatible routes

These aliases use the same services, validation, Firebase authentication, and authorization as the `/api` endpoints. The existing routes remain available.

| Method | Path | Request fields |
| --- | --- | --- |
| `POST` | `/chat/create` | JSON: `{ "userAId": "...", "userBId": "..." }`. `userAId` must match the token UID. |
| `POST` | `/chat/:chatId/message/send` | JSON: `{ "senderId": "...", "text": "..." }`. `senderId` must match the token UID. |
| `GET` | `/chat/:chatId/messages` | Query: `userId` (required; must match token UID), optional `limit` and `cursor`. |
| `POST` | `/chat/:chatId/message/:messageId/read` | JSON: `{ "userId": "..." }`. |
| `POST` | `/chat/:chatId/lastseen` | JSON: `{ "userId": "...", "messageId": "..." }`. |
| `GET` | `/user/:userId/chats` | `userId` path parameter must match the token UID. |

All `/api` endpoints require `Authorization: Bearer <Firebase ID token>`. The Firebase token UID must match the corresponding PostgreSQL `User.id`. A caller cannot choose their sender/read/last-seen identity in request data. Listing chats is limited to the authenticated user; message, read-receipt, and last-seen actions also verify chat membership. Last-seen requests must reference an existing message in that chat; records are stored at `chats/{chatId}/lastSeen/{userId}` with `messageId` and server-generated `updatedAt`. Identifiers and request data are validated with Zod. Creating the same pair in either order resolves to the same database-unique pair key. PostgreSQL migrations define foreign keys and unique membership constraints. Firestore message documents are stored at `chats/{chatId}/messages/{messageId}` with `senderId`, `content`, `createdAt`, and `readBy`.

The interactive Swagger UI is available without a token; provide a Firebase ID token using its **Authorize** control to call protected endpoints.

## Tests and checks

Run verification commands from the project root. Jest/Supertest unit tests use mocked dependencies. The integration command uses live PostgreSQL, Firebase Authentication, and Firestore services, and removes its uniquely identified test data at completion.

```sh
npm test
npm run test:integration
npm run typecheck
npm run lint
npx prisma validate
npm run build
```

The integration test requires `DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT_PATH`, `FIREBASE_WEB_API_KEY`, and `FIREBASE_TEST_PASSWORD`.
