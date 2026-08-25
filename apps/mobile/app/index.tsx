import { Redirect } from "expo-router";

/**
 * Reached only when authed (RootGate guards everything else).
 * Just forward into the tabs.
 */
export default function Gate() {
  return <Redirect href="/(tabs)/chats" />;
}
