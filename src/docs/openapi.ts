export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Chat Backend API",
    version: "1.0.0",
    description:
      "One-to-one chats use PostgreSQL. Messages and read receipts are stored in Firestore. API routes require a Firebase Authentication ID token.",
  },
  servers: [{ url: "/" }],
  tags: [{ name: "Chats" }, { name: "Users" }],
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        responses: { "200": { description: "API is available" } },
      },
    },
    "/api/chats": {
      post: {
        tags: ["Chats"],
        security: [{ BearerAuth: [] }],
        summary: "Create or get the unique one-to-one chat for the caller and another user",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["otherUserId"],
                properties: { otherUserId: { type: "string" } },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": { description: "Existing or newly created chat" },
          "400": { description: "Invalid or identical user IDs" },
          "401": { description: "Missing or invalid Firebase ID token" },
          "404": { description: "A user does not exist" },
        },
      },
    },
    "/api/chats/{chatId}/messages": {
      post: {
        tags: ["Chats"],
        security: [{ BearerAuth: [] }],
        summary: "Send a message",
        parameters: [{ $ref: "#/components/parameters/chatId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["content"],
                properties: { content: { type: "string", maxLength: 5000 } },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "201": { description: "Message created" },
          "401": { description: "Missing or invalid Firebase ID token" },
          "403": { description: "User is not a chat member" },
        },
      },
      get: {
        tags: ["Chats"],
        security: [{ BearerAuth: [] }],
        summary: "Get messages in reverse chronological order",
        parameters: [
          { $ref: "#/components/parameters/chatId" },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Message page and continuation cursor" },
          "401": { description: "Missing or invalid Firebase ID token" },
          "403": { description: "User is not a chat member" },
        },
      },
    },
    "/api/chats/{chatId}/messages/{messageId}/read": {
      patch: {
        tags: ["Chats"],
        security: [{ BearerAuth: [] }],
        summary: "Add the authenticated member to the message read receipts",
        parameters: [
          { $ref: "#/components/parameters/chatId" },
          { name: "messageId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Read receipt updated" },
          "401": { description: "Missing or invalid Firebase ID token" },
          "403": { description: "User is not a chat member" },
          "404": { description: "Message not found" },
        },
      },
    },
    "/api/chats/{chatId}/last-seen": {
      patch: {
        tags: ["Chats"],
        security: [{ BearerAuth: [] }],
        summary: "Store the authenticated member's last-seen message and timestamp in Firestore",
        parameters: [{ $ref: "#/components/parameters/chatId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["messageId"],
                properties: { messageId: { type: "string" } },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": { description: "Firestore last-seen record updated" },
          "401": { description: "Missing or invalid Firebase ID token" },
          "403": { description: "User is not a chat member" },
          "404": { description: "Message not found in this chat" },
        },
      },
    },
    "/api/users/{userId}/chats": {
      get: {
        tags: ["Users"],
        security: [{ BearerAuth: [] }],
        summary: "List the authenticated user's chats and member IDs",
        parameters: [
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "User chats from PostgreSQL" },
          "401": { description: "Missing or invalid Firebase ID token" },
          "403": { description: "Users may only list their own chats" },
          "404": { description: "User not found" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Firebase ID token",
      },
    },
    parameters: {
      chatId: {
        name: "chatId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    },
  },
} as const;
