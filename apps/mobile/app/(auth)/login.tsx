import { z } from "zod";
import { Redirect } from "expo-router";

import { api } from "@/api/client";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

export default function Login() {
  const t = useTheme();
  const { signIn, token } = useSession();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in — go straight to chats. Kept below all hooks so the
  // hook order stays stable if the session changes while mounted.
  if (token) return <Redirect href="/(tabs)/chats" />;

  async function submit() {
    setError(null);
    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    if (mode === "signup" && name.trim().length < 1) {
      setError("Enter your name");
      return;
    }
    setBusy(true);
    try {
      const res =
        mode === "signin"
          ? await api.authSignIn(email.trim(), password)
          : await api.authSignUp(email.trim(), password, name.trim());
      if (!res?.token) throw new Error("No session token in response");
      await signIn(res.token);
      // signIn sets the token → the redirect at the top of this screen
      // (or the auth gate) takes over; no manual navigation needed.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.sidebar }]} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={[styles.hero, { backgroundColor: t.sidebar }]}>
            <Text style={styles.logo}>Pulse</Text>
            <Text style={[styles.tagline, { color: t.accent300 }]}>Team chat, anywhere.</Text>
          </View>

          <View style={[styles.card, { backgroundColor: t.background, paddingBottom: Math.max(24, insets.bottom + 16) }]}>
            <Text style={[styles.heading, { color: t.foreground }]}>
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </Text>

            {mode === "signup" && (
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground },
                ]}
                placeholder="Name"
                placeholderTextColor={t.mutedForeground}
                autoCapitalize="words"
                value={name}
                onChangeText={setName}
                returnKeyType="next"
              />
            )}
            <TextInput
              style={[
                styles.input,
                { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground },
              ]}
              placeholder="Email"
              placeholderTextColor={t.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              returnKeyType="next"
            />
            <TextInput
              style={[
                styles.input,
                { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground },
              ]}
              placeholder="Password"
              placeholderTextColor={t.mutedForeground}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              returnKeyType="done"
              onSubmitEditing={submit}
            />

            {!!error && <Text style={[styles.error, { color: t.destructive }]}>{error}</Text>}

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: busy ? t.primaryHover : t.primary, opacity: pressed ? 0.9 : 1 },
              ]}
              onPress={submit}
            >
              {busy ? (
                <ActivityIndicator color={t.primaryForeground} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: t.primaryForeground }]}>
                  {mode === "signin" ? "Sign in" : "Sign up"}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}
              style={styles.switchWrap}
            >
              <Text style={[styles.switchText, { color: t.mutedForeground }]}>
                {mode === "signin" ? "No account? " : "Already have an account? "}
                <Text style={{ color: t.primary, fontWeight: "600" }}>{mode === "signin" ? "Sign up" : "Sign in"}</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "flex-end" },
  hero: {
    flex: 1,
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 32,
    paddingBottom: 16,
  },
  logo: {
    fontSize: 48,
    fontWeight: "800",
    color: "#5eead4",
  },
  tagline: {
    fontSize: 15,
    marginTop: 4,
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    gap: 12,
    paddingBottom: 40,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
  },
  error: {
    fontSize: 13,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  switchWrap: {
    alignItems: "center",
    marginTop: 6,
  },
  switchText: {
    fontSize: 14,
  },
});
