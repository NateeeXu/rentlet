import { seedEmulator } from './seed';

// Runs once before the suite, after `emulators:exec` has started Firestore: every spec sees the
// same listings. Each `emulators:exec` run starts from an empty database, so the seed is the whole
// dataset and specs stay independent without per-test cleanup.
export default async function globalSetup(): Promise<void> {
  await seedEmulator();
}
