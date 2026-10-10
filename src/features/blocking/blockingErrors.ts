export function blockingError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(code)) {
    return 'Blocking is not available yet. You can still report this user or contact shedmoapp@gmail.com.';
  }
  if (['22023', '22P02', '23503', '23514'].includes(code)) return 'This user cannot be blocked.';
  return 'Your block settings could not be updated. Check your connection and try again.';
}

export function isBlockedInteraction(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'message' in error
    && String(error.message).includes('SHEDMO_INTERACTION_UNAVAILABLE'));
}
