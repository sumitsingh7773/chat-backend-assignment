import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const demoUsers = [
    { id: "demo-user-alex", name: "Alex Demo", email: "alex.demo@example.com" },
    { id: "demo-user-jamie", name: "Jamie Demo", email: "jamie.demo@example.com" },
    { id: "demo-user-taylor", name: "Taylor Demo", email: "taylor.demo@example.com" },
  ];

  for (const user of demoUsers) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { name: user.name, email: user.email },
      create: user,
    });
  }

  console.log(`Seeded ${demoUsers.length} demo users.`);
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed demo users", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
