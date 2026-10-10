export interface ErrorContext {
  operation?: string;
  screen?: string;
}

export type AnalyticsEventName =
  | 'signup_completed' | 'login_completed' | 'listing_created' | 'listing_viewed'
  | 'listing_saved' | 'listing_shared' | 'listing_reported' | 'search_performed'
  | 'filter_applied' | 'conversation_started' | 'message_sent'
  | 'stripe_onboarding_started' | 'stripe_onboarding_completed' | 'checkout_started'
  | 'checkout_payment_sheet_opened' | 'checkout_succeeded' | 'checkout_failed'
  | 'pickup_ready' | 'pickup_confirmed' | 'shipment_recorded' | 'delivery_confirmed'
  | 'inspection_completed' | 'review_submitted' | 'dispute_opened'
  | 'local_direct_sale_started' | 'local_direct_sale_confirmed' | 'local_direct_sale_rejected'
  | 'protected_checkout_selected' | 'protected_checkout_completed';

type EntityType = 'listing' | 'order' | 'conversation' | 'review' | 'report' | 'seller' | 'local_sale';
type SafeMetadata = Partial<Record<'category'|'fulfillment_type'|'result_status'|'filter_count'|'price_bucket'|'screen'|'method', string|number|boolean>>;

export interface TelemetryClient {
  recordError: (error: unknown, context?: ErrorContext) => void;
  track: (eventName: AnalyticsEventName, entityType?: EntityType, entityId?: string, metadata?: SafeMetadata) => void;
}

// Deliberately local-only until a privacy-reviewed crash provider is selected.
// Marketplace content and user identifiers must never be added to this context.
export const telemetry: TelemetryClient = {
  recordError(error, context) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    if (__DEV__) console.error('[app:error]', {
      errorName,
      operation: context?.operation ?? null,
      screen: context?.screen ?? null,
    });
    void import('@/lib/supabase/client').then(({ supabase }) => supabase?.rpc('record_marketplace_client_error_v1', {
      p_error_code: errorName.replace(/[^a-z0-9]/gi, '_').toUpperCase().slice(0, 80) || 'UNKNOWN_ERROR',
      p_operation: context?.operation?.replace(/[^a-z0-9_:-]/gi, '_').toLowerCase().slice(0, 80) ?? null,
      p_metadata: context?.screen ? { screen: context.screen.slice(0, 80) } : {},
    })).catch(() => undefined);
  },
  track(eventName, entityType, entityId, metadata = {}) {
    void import('@/lib/supabase/client').then(({ supabase }) => supabase?.rpc('record_marketplace_analytics_event_v1', {
      p_event_name: eventName,
      p_entity_type: entityType ?? null,
      p_entity_id: entityId ?? null,
      p_metadata: metadata,
    })).catch(() => undefined);
  },
};
