export const CONTENT_SAFETY_MESSAGE = "This content can't be posted because it violates Shedmo's Marketplace Rules.";

export function isContentSafetyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'message' in error
    && typeof error.message === 'string'
    && (error.message === 'SHEDMO_CONTENT_NOT_ALLOWED' || error.message === CONTENT_SAFETY_MESSAGE);
}
