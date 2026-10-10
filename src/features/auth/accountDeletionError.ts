const statusFromFunctionError = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('context' in error)) return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('status' in context)) return null;
  const status = (context as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
};

export function accountDeletionError(error: unknown) {
  const status = statusFromFunctionError(error);
  if (status === 409) {
    return 'Your account cannot be deleted until unresolved marketplace activity is completed or canceled.';
  }
  if (status === 404) {
    return 'Account deletion is temporarily unavailable. Please try again later.';
  }
  return 'Account deletion could not be completed. Please try again.';
}
