
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import serviceAccount from "../credentials/firebase-service-account.json";

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount as any) });
}

async function main() {
  const users = [
    {
      uid: "demo-user-jamie",
      email: "jamie.test@example.com",
      password: "JamieTest@123",
      displayName: "Jamie",
    },
    {
      uid: "demo-user-taylor",
      email: "taylor.test@example.com",
      password: "TaylorTest@123",
      displayName: "Taylor",
    },
  ];

  for (const user of users) {
    try {
      await getAuth().createUser(user);
      console.log(`Created: ${user.displayName}`);
    } catch (error: any) {
      if (error.code === "auth/uid-already-exists") {
        console.log(`Already exists: ${user.uid}`);
      } else {
        throw error;
      }
    }
  }
}

main().catch(console.error);
