import { Redirect } from "expo-router";

import { useRequireSession } from "@/hooks/useRequireSession";

/** Entry route: forward into the tabs (session is checked per-area). */
export default function Gate() {
  const blocker = useRequireSession();
  if (blocker) return blocker;
  return <Redirect href="/(tabs)/chats" />;
}
