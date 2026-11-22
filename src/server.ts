import "dotenv/config";
import app from "./app";
import prisma from "./config/database";

const port = process.env.PORT ?? 3000;
const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

function shutdown() {
  server.close(() => {
    void prisma.$disconnect();
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);