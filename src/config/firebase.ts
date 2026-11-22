import { readFileSync } from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";

let firestore: Firestore | undefined;

export function getFirebaseApp() {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;
  const credentialsPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ??
      "credentials/firebase-service-account.json"
  );

  let serviceAccount: unknown;
  try {
    serviceAccount = JSON.parse(readFileSync(credentialsPath, "utf8"));
  } catch {
    throw new Error(
      `Unable to load Firebase service account from ${credentialsPath}. Set FIREBASE_SERVICE_ACCOUNT_PATH to a valid credential file.`
    );
  }

  return initializeApp({
    credential: cert(serviceAccount as Parameters<typeof cert>[0]),
  });
}

export function getFirestoreClient(): Firestore {
  if (!firestore) firestore = getFirestore(getFirebaseApp());
  return firestore;
}
