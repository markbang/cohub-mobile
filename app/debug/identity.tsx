import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useProfileSession } from "@/src/auth/profile-session";
import { useApp } from "@/src/data/context";
import { AppIcon, PrimaryButton, Screen, SectionHeader } from "@/src/ui";
import type { IconName } from "@/src/icons";

type TokenInfo = { present: boolean; length: number };

function maskEmail(value: unknown) {
  if (typeof value !== "string" || !value.includes("@")) return null;
  const [user, domain] = value.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}

function formatClaim(key: string, value: unknown) {
  if (key === "email") return maskEmail(value) ?? "—";
  if (key === "exp" && typeof value === "number") return new Date(value * 1000).toLocaleString();
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export default function DebugIdentityScreen() {
  const { userUuid, installationId, getAccessToken } = useApp();
  const { getClaims } = useProfileSession();
  const [claims, setClaims] = useState<Record<string, unknown> | null>(null);
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [expiresInSeconds, setExpiresInSeconds] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadClaims = useCallback(async () => {
    setBusy("claims");
    setError(null);
    try {
      const next = await getClaims();
      setClaims(next);
      setExpiresInSeconds(typeof next.exp === "number" ? Math.round(next.exp - Date.now() / 1000) : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取 claims 失败");
    } finally {
      setBusy(null);
    }
  }, [getClaims]);

  const loadToken = useCallback(async (forceRefresh: boolean) => {
    setBusy(forceRefresh ? "refresh" : "token");
    setError(null);
    try {
      const value = await getAccessToken(forceRefresh ? { forceRefresh: true } : undefined);
      setToken({ present: Boolean(value), length: value?.length ?? 0 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取 token 失败");
    } finally {
      setBusy(null);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      void loadClaims();
      void loadToken(false);
    });
  }, [loadClaims, loadToken]);

  const claimEntries = claims ? Object.entries(claims).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="身份" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <Row icon="fingerprint" label="userUuid" value={userUuid} />
          <Row icon="user" label="display" value={typeof claims?.name === "string" ? claims.name : "—"} />
          <Row icon="globe" label="email" value={maskEmail(claims?.email) ?? "—"} />
          <Row icon="wifi" label="installation" value={installationId ?? "preparing…"} />
          <Row icon="monitor" label="environment" value={String(Constants.executionEnvironment)} />
        </View>

        <SectionHeader title="访问令牌" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <Row icon="shield" label="存在" value={token ? (token.present ? "yes" : "no") : "…"} />
          <Row icon="code" label="长度" value={token ? String(token.length) : "…"} />
          <Row icon="refresh" label="剩余有效期" value={expiresInSeconds != null ? `${expiresInSeconds}s` : "—"} />
        </View>
        <Text className="text-micro font-semibold text-fg-faint mx-4 mt-2">
          只显示令牌是否存在与长度，绝不显示明文；claims 中的邮箱也做了掩码。
        </Text>
        <View className="px-4 pt-3 gap-2">
          <PrimaryButton label="读取 claims" icon="user" loading={busy === "claims"} disabled={busy !== null} onPress={() => void loadClaims()} />
          <PrimaryButton label="读取 token" icon="shield" loading={busy === "token"} disabled={busy !== null} onPress={() => void loadToken(false)} />
          <PrimaryButton label="强制刷新 token" icon="refresh" variant="danger" loading={busy === "refresh"} disabled={busy !== null} onPress={() => void loadToken(true)} />
        </View>
        {error ? <Text selectable className="text-caption text-danger mx-4 mt-3">{error}</Text> : null}

        <SectionHeader title={`ID Token claims · ${claimEntries.length}`} />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          {claimEntries.length === 0 ? (
            <Text className="text-caption text-fg-muted p-4">暂无 claims</Text>
          ) : claimEntries.map(([key, value]) => (
            <View key={key} className="px-3 py-2 border-b border-border gap-1">
              <Text className="text-micro text-accent" style={{ fontFamily: "SpaceMono" }}>{key}</Text>
              <Text selectable className="text-caption text-fg-secondary">{formatClaim(key, value)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Row({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View className="min-h-13 px-3 py-2 flex-row items-center gap-3 border-b border-border">
      <View className="w-8 h-8 rounded-sm items-center justify-center bg-surface-raised">
        <AppIcon name={icon} size={15} tone="muted" />
      </View>
      <Text className="text-caption text-fg-muted w-28">{label}</Text>
      <Text selectable numberOfLines={2} className="text-caption text-fg flex-1 text-right">{value}</Text>
    </View>
  );
}

