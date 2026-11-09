import type { SpaceWalletFundingTier } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { GroupRow, GroupTile } from "@/src/components/GroupRow";
import { formatUsd } from "@/src/data/space-wallet";
import { customAmountError, fundMethod, useSpaceFunding } from "@/src/data/use-space-funding";
import { useTranslation } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { useAppTheme } from "@/src/theme";
import { AppIcon, Avatar, DataError, LoadingSections, PrimaryButton, Screen, SettingsGroup, TopBar } from "@/src/ui";

/** Funds a Space's shared wallet: members and, when its host allows it, anyone signed in. */
export default function SpaceFundScreen() {
  const { spaceId = "" } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const fund = useSpaceFunding(spaceId);
  const { funding, result } = fund;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [preferCheckout, setPreferCheckout] = useState(false);

  const tiers = funding?.tiers ?? [];
  const transfer = funding?.transfer ?? null;
  const custom = customOpen || tiers.length === 0;
  const tier: SpaceWalletFundingTier | null = custom ? null : tiers.find((item) => item.productKey === selectedKey) ?? tiers[0] ?? null;
  const customAmount = customValue.trim() && Number.isInteger(Number(customValue)) ? Number(customValue) : null;
  const amount = tier ? tier.amountUsd : customAmount;
  const customError = funding && custom ? customAmountError(funding, customValue) : null;
  const method = !funding || amount === null || (custom && customError) ? null : fundMethod(funding, amount, Boolean(tier), preferCheckout);
  const covers = (value: number) => Boolean(transfer && value <= transfer.allowanceUsd);
  const alternate = tier && funding ? method === "balance" && funding.checkout ? "checkout" : method === "checkout" && covers(tier.amountUsd) ? "balance" : null : null;
  const spaceName = funding?.space.name || t("space.fallbackName");

  const submit = () => {
    if (!method || amount === null) return;
    if (method === "balance") { void fund.payFromBalance(amount); return; }
    if (!tier) return;
    void fund.run(async () => {
      const url = await fund.startCheckout(tier);
      if (!url) return;
      await openWebLink(url).catch(() => undefined);
      await fund.confirmCheckout();
    });
  };

  return <Screen scroll keyboard>
    <TopBar title={t("wallet.fund.title", { space: spaceName })} onBack={() => router.back()} />
    {fund.error && !funding ? <DataError message={fund.error} onRetry={fund.reload} /> : null}
    {!funding && !fund.error ? <LoadingSections sections={[{ kind: "hero" }, { kind: "group", rows: 3 }]} /> : null}
    {funding ? <>
      <View className="flex-row items-center gap-3 px-6 pt-4 pb-2">
        <Avatar name={spaceName} uri={funding.space.avatarUrl} size={44} />
        <View className="min-w-0 flex-1">
          <Text accessibilityRole="header" numberOfLines={2} className="text-headline font-semibold text-fg">{spaceName}</Text>
          {funding.space.description ? <Text numberOfLines={3} className="text-caption text-fg-muted">{funding.space.description}</Text> : null}
        </View>
      </View>
      <Text className="px-6 pb-4 text-caption text-fg-muted">{t("wallet.fund.note")}</Text>
      {result && result.state !== "none" ? (
        <SettingsGroup>
          <View accessibilityLiveRegion="polite" className="gap-3 p-4">
            <View className="flex-row items-center gap-2">
              <AppIcon name={result.state === "completed" ? "check-circle" : result.state === "processing" ? "clock" : "history"} size={18} tone={result.state === "completed" ? "success" : "muted"} />
              <Text className="min-w-0 flex-1 text-body text-fg">{result.state === "completed" ? t("wallet.fund.done", { amount: formatUsd(result.creditedUsd), space: spaceName }) : result.state === "processing" ? t("wallet.fund.processing") : t("wallet.fund.refunded", { amount: formatUsd(result.refundedUsd) })}</Text>
            </View>
            {result.state !== "processing" ? <PrimaryButton variant="secondary" label={t("wallet.fund.again")} onPress={() => { fund.reset(); setCustomValue(""); }} className="self-start" /> : null}
          </View>
        </SettingsGroup>
      ) : tiers.length === 0 && !transfer ? (
        <Text className="px-6 text-body text-fg-muted">{t("wallet.fund.unavailable")}</Text>
      ) : <>
        {tiers.length > 0 ? <SettingsGroup label={t("wallet.fund.amount")}>
          {tiers.map((item, index) => {
            const selected = tier?.productKey === item.productKey;
            return <GroupRow
              key={item.productKey}
              leading={<GroupTile icon="wallet" accent={selected} />}
              title={formatUsd(item.amountUsd)}
              subtitle={covers(item.amountUsd) ? t("wallet.fund.viaBalance") : funding.checkout ? t("wallet.fund.viaCheckout", { amount: formatUsd(item.priceUsd) }) : undefined}
              role="button"
              accessibilityLabel={`${formatUsd(item.amountUsd)}${selected ? `, ${t("wallet.fund.selected")}` : ""}`}
              trailing={selected ? <AppIcon name="check" size={18} tone="accent" /> : null}
              onPress={() => { setSelectedKey(item.productKey); setCustomOpen(false); setPreferCheckout(false); }}
              last={index === tiers.length - 1 && !transfer}
            />;
          })}
          {transfer && !custom ? <GroupRow leading={<GroupTile icon="square-pen" />} title={t("wallet.fund.other")} onPress={() => setCustomOpen(true)} last /> : null}
        </SettingsGroup> : null}
        {transfer && custom ? <SettingsGroup label={t("wallet.fund.other")} footer={customError ?? t("wallet.fund.otherHint", { min: formatUsd(transfer.minUsd), max: formatUsd(transfer.maxUsd) })}>
          <View className="min-h-13 flex-row items-center gap-2 bg-surface px-4">
            <Text className="text-body text-fg-muted">$</Text>
            <TextInput
              autoFocus={tiers.length > 0}
              value={customValue}
              onChangeText={(value) => setCustomValue(value.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              placeholder={String(transfer.minUsd)}
              placeholderTextColor={theme.colors.textFaint}
              accessibilityLabel={t("wallet.fund.other")}
              returnKeyType="done"
              onSubmitEditing={submit}
              className="min-w-0 flex-1 py-3 text-body tabular-nums text-fg"
            />
            <Text className="text-caption text-fg-muted">USD</Text>
          </View>
        </SettingsGroup> : null}
        <View className="gap-3 px-4 pb-6">
          <PrimaryButton
            label={method === "checkout" && tier ? t("wallet.fund.payCheckout", { amount: formatUsd(tier.priceUsd) }) : t("wallet.fund.payBalance", { amount: amount === null ? "—" : formatUsd(amount) })}
            loading={fund.busy}
            disabled={!method || amount === null}
            onPress={submit}
          />
          {fund.notice ? <Text accessibilityRole="alert" selectable className="text-caption text-danger">{fund.notice}</Text> : null}
          {fund.checkoutPending && !fund.busy ? <Pressable accessibilityRole="button" onPress={() => void fund.run(fund.confirmCheckout)} className="min-h-11 justify-center"><Text className="text-subhead font-semibold text-accent">{t("space.wallet.paymentPending")}</Text></Pressable> : null}
          {transfer ? <Text className="text-caption text-fg-muted">{t("wallet.fund.allowance", { amount: formatUsd(transfer.allowanceUsd) })} · {t("wallet.fund.allowanceNote")}</Text> : null}
          {alternate ? <Pressable accessibilityRole="button" onPress={() => setPreferCheckout(alternate === "checkout")} className="min-h-11 justify-center self-start"><Text className="text-subhead font-semibold text-accent">{alternate === "checkout" ? t("wallet.fund.checkoutInstead") : t("wallet.fund.balanceInstead")}</Text></Pressable> : null}
        </View>
      </>}
    </> : null}
  </Screen>;
}
