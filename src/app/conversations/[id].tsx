import { useLocalSearchParams } from 'expo-router';

import { ConversationScreen } from '@/features/messaging/ConversationScreen';

export default function ConversationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ConversationScreen conversationId={id} />;
}
