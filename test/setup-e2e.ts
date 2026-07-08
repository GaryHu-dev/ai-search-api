import { loadEnvFile } from 'node:process';

// Load local .env so e2e tests can read configuration (e.g. whether object
// storage is available). In CI there is no .env — real environment variables
// are already present, so a missing file is fine.
try {
  loadEnvFile('.env');
} catch {
  // No .env file; rely on the ambient environment.
}
