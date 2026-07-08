// Treat addresses case- and whitespace-insensitively so "same email = same
// person" holds regardless of how the user typed it in.
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
