export function friendlyError(message: string) {
  if (message === 'SHEDMO_CONTENT_NOT_ALLOWED') {
    return "This content can't be posted because it violates Shedmo's Marketplace Rules.";
  }
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'The email or password is incorrect.';
  if (normalized.includes('email not confirmed')) return 'Verify your email before signing in.';
  if (normalized.includes('user already registered')) return 'An account already exists for this email.';
  if (normalized.includes('duplicate key') && normalized.includes('username')) return 'That username is already taken.';
  if (normalized.includes('rate limit') || normalized.includes('too many requests')) {
    return 'Too many account requests were made recently. Please wait a few minutes and try again.';
  }
  if (normalized.includes('network') || normalized.includes('fetch')) return 'Unable to reach Supabase. Check your connection and try again.';
  return 'The request could not be completed. Please try again.';
}

export function passwordUpdateError(error: { code?: string; message: string }) {
  const normalized = error.message.toLowerCase();
  if (error.code === 'same_password' || normalized.includes('password should be different')) {
    return 'Your new password must be different from your current password.';
  }
  return friendlyError(error.message);
}
