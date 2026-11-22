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

Run each verification command from the project root:

The Jest/Supertest tests use mocked Prisma and Firestore dependencies; they do not require live database or Firebase credentials.

```sh
npm test
npm run typecheck
npx prisma validate
npm run build
```
