import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { File as ExpoFile } from "expo-file-system";
import type {
	BillingCatalog,
	BillingCreditStatus,
	Channel,
	CohubClient,
	UserActivityResponse,
	UserProfile,
} from "@neta-art/cohub";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import {
	Linking,
	Platform,
	Pressable,
	ScrollView,
	Share,
	Text,
	TextInput,
	View,
} from "react-native";
import { ConfirmSheet, NoticeSheet } from "@/src/components/SystemDialogs";
import { BrowserSettings } from "@/src/components/BrowserSettings";
import { ChannelBindingSheet } from "@/src/components/ChannelBindingSheet";
import { channelHealthState } from "@/src/data/channel-settings";
import { useUserRules } from "@/src/data/use-user-rules";
import { useReferrals } from "@/src/data/use-referrals";
import { useProfileSession } from "@/src/auth/profile-session";
import { useAppActions } from "@/src/data/context";
import { useScreenQuery } from "@/src/data/query";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/src/i18n";
import { settingsSections, type SettingsSection } from "@/src/data/settings-navigation";
import {
	registerForPushNotifications,
	type PushRegistrationResult,
} from "@/src/platform/notifications";
import { useAppTheme } from "@/src/theme";
import { AppIcon, Avatar, DataError, EmptyState, Field, FIELD_INPUT_CLASS, IconButton, Loader, LoadingState, PrimaryButton, Screen, Segmented, SettingsGroup, StatusPill, TopBar, type IconName } from "@/src/ui";
import { SettingsRow } from "@/src/components/SettingsRow";
import { GroupRow, GroupSeparator, GroupSlot, GroupTile } from "@/src/components/GroupRow";
import { formatNumber, formatRelativeTime } from "@/src/utils";
import { openWebLink } from "@/src/platform/browser";
import { formatUsd } from "@/src/data/space-wallet";

type ProfileState = {
	profile: UserProfile | null;
	email: string | null;
	uuid: string;
};

export function SettingsScreen({ section }: { section: SettingsSection }) {
	const router = useRouter();
	const theme = useAppTheme();
	const { t } = useTranslation();
	const insets = useSafeAreaInsets();
	const { client, installationId, getAccessToken } = useAppActions();
	const queryClient = useQueryClient();
	const [notice, setNotice] = useState<{
		title: string;
		message: string;
	} | null>(null);

	return (
		<Screen keyboard>
			<TopBar
				title={t(settingsSections[section].labelKey)}
				onBack={() => router.back()}
				actions={section === "channels" ? <>
					<IconButton name="refresh" label={t("common.refresh")} onPress={() => void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY })} />
					<IconButton name="plus" label={t("settings.channels.add")} onPress={() => router.push("/settings/new-channel")} />
				</> : undefined}
			/>
			<ScrollView
				className="flex-1"
				contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing.xl }}
				keyboardShouldPersistTaps="handled"
			>
				{section === "profile" ? (
					<ProfileSection client={client} onNotice={setNotice} />
				) : null}
				{section === "browser" ? <BrowserSettings /> : null}
				{section === "activity" ? <ActivitySection client={client} /> : null}
				{section === "notifications" ? (
					<NotificationsSection
						client={client}
						installationId={installationId}
						getAccessToken={getAccessToken}
						onNotice={setNotice}
					/>
				) : null}
				{section === "rules" ? <RulesSection /> : null}
				{section === "channels" ? (
					<ChannelsSection client={client} onNotice={setNotice} />
				) : null}
				{section === "billing" ? (
					<BillingSection client={client} onNotice={setNotice} />
				) : null}
				{section === "referrals" ? (
					<ReferralsSection client={client} onNotice={setNotice} />
				) : null}
			</ScrollView>
			<NoticeSheet notice={notice} fallbackTitle={t("common.notice")} onClose={() => setNotice(null)} testID="settings-notice-sheet" />
		</Screen>
	);
}



const PROFILE_KEY = ["profile"];
const EMPTY_PROFILE: ProfileState = { profile: null, email: null, uuid: "" };

function ProfileSection({
	client,
	onNotice,
}: {
	client: CohubClient | null;
	onNotice: (notice: { title: string; message: string }) => void;
}) {
	const theme = useAppTheme();
	const { t } = useTranslation();
	const { getClaims } = useProfileSession();
	const queryClient = useQueryClient();
	const profileQuery = useScreenQuery({
		queryKey: PROFILE_KEY,
		queryFn: async (): Promise<ProfileState> => {
			const [me, claims] = await Promise.all([client!.user.getMe(), getClaims()]);
			return {
				profile: me.profile,
				email: me.email ?? (typeof claims.email === "string" ? claims.email : null),
				uuid: me.uuid,
			};
		},
		enabled: Boolean(client),
	});
	const data = profileQuery.data ?? EMPTY_PROFILE;
	const setProfile = (profile: NonNullable<ProfileState["profile"]>) =>
		queryClient.setQueryData<ProfileState>(PROFILE_KEY, (current) => ({ ...(current ?? EMPTY_PROFILE), profile }));
	// The form seeds once from the first read; background reads never overwrite typing.
	const [seededFrom, setSeededFrom] = useState<ProfileState["profile"]>(null);
	const [displayName, setDisplayName] = useState("");
	const [username, setUsername] = useState("");
	if (data.profile && !seededFrom) {
		setSeededFrom(data.profile);
		setDisplayName(data.profile.displayName);
		setUsername(data.profile.username ?? "");
	}
	const loading = Boolean(client) && profileQuery.isPending;
	const [saving, setSaving] = useState(false);
	const [uploadingAvatar, setUploadingAvatar] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const error = actionError ?? (!client ? t("settings.profile.connect") : profileQuery.error ? profileQuery.error.message || t("settings.profile.loadError") : null);
	const load = () => { setActionError(null); void profileQuery.refetch(); };

	const changeAvatar = async () => {
		if (!client || uploadingAvatar) return;
		setUploadingAvatar(true);
		setActionError(null);
		try {
			const permission =
				await ImagePicker.requestMediaLibraryPermissionsAsync();
			if (!permission.granted) {
				onNotice({
					title: t("settings.profile.photoOff.title"),
					message: t("settings.profile.photoOff.body"),
				});
				return;
			}
			const result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ["images"],
				quality: 0.9,
			});
			if (result.canceled) return;
			const asset = result.assets[0];
			if (!asset) return;
			const file: Blob =
				Platform.OS === "web"
					? await (await fetch(asset.uri)).blob()
					: new ExpoFile(asset.uri);
			const uploaded = await client.publicAssets.upload({
				purpose: "user_avatar",
				file,
				mimeType: file.type || asset.mimeType || "image/jpeg",
				filename: asset.fileName || "avatar.jpg",
			});
			const updated = await client.user.updateProfile({
				avatarUrl: uploaded.publicUrl,
			});
			setProfile(updated.profile);
			onNotice({
				title: t("settings.profile.avatarUpdated.title"),
				message: t("settings.profile.avatarUpdated.body"),
			});
		} catch (caught) {
			setActionError(
				caught instanceof Error ? caught.message : t("settings.profile.avatarError"),
			);
		} finally {
			setUploadingAvatar(false);
		}
	};

	const save = async () => {
		if (!client || saving || !displayName.trim()) return;
		setSaving(true);
		setActionError(null);
		try {
			const result = await client.user.updateProfile({
				displayName: displayName.trim(),
				username: username.trim() || null,
			});
			setProfile(result.profile);
			setDisplayName(result.profile.displayName);
			setUsername(result.profile.username ?? "");
			onNotice({
				title: t("settings.profile.updated.title"),
				message: t("settings.profile.updated.body"),
			});
		} catch (caught) {
			setActionError(
				caught instanceof Error ? caught.message : t("settings.profile.saveError"),
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<View className="pt-4">
			{loading && !data.profile ? (
				<LoadingBlock />
			) : error && !data.profile ? (
				<InlineError message={error} onRetry={() => void load()} />
			) : (
				<>
					<View className="items-center pb-6">
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={t("settings.profile.changeAvatar")}
							onPress={() => void changeAvatar()}
							disabled={uploadingAvatar}
							className="rounded-lg active:opacity-65 disabled:opacity-65"
						>
							<Avatar
								name={data.profile?.displayName || t("settings.profile.fallbackName")}
								uri={data.profile?.avatarUrl}
								size={82}
							/>
						</Pressable>
						{uploadingAvatar ? (
							<View className="mt-2 flex-row items-center gap-2">
								<Loader />
								<Text className="text-caption text-fg-muted">{t("settings.profile.uploadingAvatar")}</Text>
							</View>
						) : null}
						<Text className={`text-headline font-semibold text-fg ${uploadingAvatar ? "mt-2" : "mt-3"}`}>
							{data.profile?.displayName || t("settings.profile.fallbackName")}
						</Text>
						{data.email ? <Text className="mt-1 text-caption text-fg-muted">{data.email}</Text> : null}
						<Text className="mt-2 text-caption text-fg-faint">{t("settings.profile.tapAvatar")}</Text>
					</View>
					<SettingsGroup>
						<View className="gap-4 p-4">
							<Field label={t("settings.profile.displayName")}>
								<TextInput
									value={displayName}
									onChangeText={setDisplayName}
									maxLength={120}
									placeholder={t("settings.profile.displayNamePlaceholder")}
									placeholderTextColor={theme.colors.textFaint}
									className={FIELD_INPUT_CLASS}
								/>
							</Field>
							<Field label={t("settings.profile.username")}>
								<TextInput
									value={username}
									onChangeText={setUsername}
									maxLength={39}
									autoCapitalize="none"
									placeholder={t("settings.profile.usernamePlaceholder")}
									placeholderTextColor={theme.colors.textFaint}
									className={FIELD_INPUT_CLASS}
								/>
							</Field>
							{error ? <Text accessibilityRole="alert" selectable className="text-caption text-danger">{error}</Text> : null}
							<PrimaryButton
								label={saving ? t("settings.profile.saving") : t("settings.profile.save")}
								icon="check"
								loading={saving}
								disabled={!displayName.trim()}
								onPress={() => void save()}
							/>
						</View>
					</SettingsGroup>
					<SettingsGroup label={t("settings.profile.section.identity")}>
						<SettingsRow icon="fingerprint" title={t("settings.profile.userId")} value={data.uuid || t("settings.profile.unavailable")} />
						<SettingsRow icon="user" title={t("settings.profile.username")} detail={username ? `@${username}` : t("settings.profile.notSet")} last />
					</SettingsGroup>
				</>
			)}
		</View>
	);
}

function ActivitySection({ client }: { client: CohubClient | null }) {
	const { t } = useTranslation();
	const [days, setDays] = useState(30);
	const query = useScreenQuery({
		queryKey: ["settings-activity", days],
		queryFn: (): Promise<UserActivityResponse> => client!.user.getActivity({ days }),
		enabled: Boolean(client),
		placeholderData: keepPreviousData,
	});
	const data = query.data ?? null;
	const loading = Boolean(client) && query.isFetching && (query.isPending || query.isPlaceholderData);
	const error = !client ? t("settings.activity.connect") : query.error ? query.error.message || t("settings.activity.error") : null;
	const load = () => query.refetch();
	const summary = data?.summary;
	const topModels = (data?.rankings.llmModels ?? []).slice(0, 8);
	return (
		<View className="pt-4">
			<View className="px-4 pb-4">
				<Segmented
					value={String(days)}
					options={[7, 30, 365].map((value) => ({ value: String(value), label: value === 365 ? t("settings.activity.range.oneYear") : t("settings.activity.range.days", { days: value }) }))}
					onChange={(value) => setDays(Number(value))}
				/>
			</View>
			{loading ? (
				<LoadingBlock />
			) : error ? (
				<InlineError message={error} onRetry={() => void load()} />
			) : (
				<>
					<View className="flex-row gap-2 px-4 pb-6">
						<Metric label={t("settings.activity.metric.tokens")} value={formatNumber(summary?.totalTokens)} icon="layers" />
						<Metric label={t("settings.activity.metric.requests")} value={formatNumber(summary?.requestCount)} icon="zap" />
						<Metric label={t("settings.activity.metric.success")} value={formatNumber(summary?.successCount)} icon="check-circle" />
					</View>
					<SettingsGroup label={t("settings.activity.topModels")}>
						{topModels.map((item, index) => (
							<GroupRow
								key={`${item.provider}/${item.model}`}
								leading={<GroupSlot><Text className="text-subhead tabular-nums text-fg-faint">{index + 1}</Text></GroupSlot>}
								title={item.model}
								subtitle={item.provider}
								trailing={<Text className="text-subhead tabular-nums text-fg-muted">{formatNumber(item.totalTokens)}</Text>}
								last={index === topModels.length - 1}
							/>
						))}
						{topModels.length === 0 ? <Text className="p-4 text-body text-fg-muted">{t("settings.activity.noUsage")}</Text> : null}
					</SettingsGroup>
				</>
			)}
		</View>
	);
}

function NotificationsSection({
	client,
	installationId,
	getAccessToken,
	onNotice,
}: {
	client: CohubClient | null;
	installationId: string | null;
	getAccessToken: (options?: {
		forceRefresh?: boolean;
	}) => Promise<string | null>;
	onNotice: (notice: { title: string; message: string }) => void;
}) {
	const { t } = useTranslation();
	const [result, setResult] = useState<PushRegistrationResult | null>(null);
	const [loading, setLoading] = useState(false);
	const enable = async () => {
		if (loading) return;
		setLoading(true);
		try {
			const next = await registerForPushNotifications({
				getAccessToken,
				installationId,
			});
			setResult(next);
			if (next.status === "enabled")
				onNotice({
					title: t("settings.notifications.enabled.title"),
					message: t("settings.notifications.enabled.body"),
				});
			else
				onNotice({ title: t("settings.notifications.unavailable.title"), message: next.message });
		} catch (error) {
			onNotice({
				title: t("settings.notifications.unavailable.title"),
				message:
					error instanceof Error
						? error.message
						: t("settings.notifications.unavailable.body"),
			});
		} finally {
			setLoading(false);
		}
	};
	const status =
		result?.status === "enabled"
			? t("settings.notifications.status.enabled")
			: result?.status === "unavailable"
				? t("settings.notifications.status.needsSetup")
				: t("settings.notifications.status.notConfigured");
	const permissionDenied = result?.status === "unavailable" && result.reason === "permission-denied";
	return (
		<View className="pt-4">
			{/* The build note only explains an Android failure; it means nothing on iOS or once enabled. */}
			<SettingsGroup footer={Platform.OS === "android" && result?.status === "unavailable" ? t("settings.notifications.androidNote") : undefined}>
				<SettingsRow icon="bell" title={t("settings.notifications.row.title")} value={result?.message ?? t("settings.notifications.row.detail")}>
					<StatusPill
						label={status}
						tone={result?.status === "enabled" ? "success" : result?.status === "unavailable" ? "warning" : "neutral"}
					/>
				</SettingsRow>
				<GroupRow
					leading={loading ? <GroupSlot><Loader /></GroupSlot> : <GroupTile icon="bell" accent />}
					title={loading ? t("settings.notifications.checking") : t("settings.notifications.enable")}
					titleClassName="text-accent"
					disabled={loading}
					onPress={() => void enable()}
					last={!permissionDenied}
				/>
				{permissionDenied ? <SettingsRow icon="settings" title={t("settings.notifications.openSystem")} external onPress={() => void Linking.openSettings()} last /> : null}
			</SettingsGroup>
			<SettingsGroup label={t("settings.notifications.section.device")}>
				<SettingsRow
					icon="fingerprint"
					title={t("settings.notifications.installation")}
					detail={installationId ? `${installationId.slice(0, 8)}…` : t("settings.notifications.preparingIdentity")}
				/>
				<SettingsRow
					icon="wifi"
					title={t("settings.notifications.delivery")}
					detail={client ? t("settings.notifications.connected") : t("settings.notifications.waiting")}
					last
				/>
			</SettingsGroup>
		</View>
	);
}

function RulesSection() {
	const { t } = useTranslation();
	const router = useRouter();
	const { data, loading, opening, error, openError, load, openHome } = useUserRules();
	return (
		<View className="pt-4">
			{loading ? (
				<LoadingBlock />
			) : error ? (
				<InlineError message={error} onRetry={() => void load()} />
			) : (
				<>
					<SettingsGroup footer={t("settings.rules.homeHint", { file: "AGENTS.md" })}>
						<SettingsRow
							icon="file-text"
							title={data?.path || "AGENTS.md"}
							value={data?.updatedAt ? t("settings.rules.updated", { time: formatRelativeTime(data.updatedAt) }) : t("settings.rules.notPublished")}
						/>
						<ScrollView style={RULES_PREVIEW} contentContainerClassName="p-4">
							{/* design-system: rule files read as source, in the bundled monospace face. */}
							<Text selectable className="text-code text-fg-secondary" style={MONO}>
								{data?.content?.trim() || t("settings.rules.none")}
							</Text>
						</ScrollView>
					</SettingsGroup>
					<SettingsGroup>
						<GroupRow
							leading={opening ? <GroupSlot><Loader /></GroupSlot> : <GroupTile icon="arrow-right" accent />}
							title={t("settings.rules.openHome")}
							titleClassName="text-accent"
							disabled={opening}
							onPress={() => void openHome().then((space) => { if (space) router.push({ pathname: "/space/[spaceId]", params: { spaceId: space.id } }); })}
							last
						/>
					</SettingsGroup>
					{openError ? <Text accessibilityRole="alert" selectable className="-mt-4 px-8 text-caption text-danger">{openError}</Text> : null}
				</>
			)}
		</View>
	);
}

const CHANNELS_KEY = ["channels"];
const EMPTY_CHANNELS: Channel[] = [];

function ChannelsSection({
	client,
	onNotice,
}: {
	client: CohubClient | null;
	onNotice: (notice: { title: string; message: string }) => void;
}) {
	const { t } = useTranslation();
	const router = useRouter();
	const [bindingChannel, setBindingChannel] = useState<Channel | null>(null);
	const queryClient = useQueryClient();
	const query = useScreenQuery({ queryKey: CHANNELS_KEY, queryFn: (): Promise<Channel[]> => client!.channels.list(), enabled: Boolean(client) });
	const channels = query.data ?? EMPTY_CHANNELS;
	const loading = Boolean(client) && query.isPending;
	const error = !client ? t("settings.channels.connect") : query.error ? query.error.message || t("settings.channels.error") : null;
	const load = () => query.refetch();
	const [removeCandidate, setRemoveCandidate] = useState<Channel | null>(null);
	const [removing, setRemoving] = useState(false);
	const confirmRemove = async () => {
		if (!client || !removeCandidate || removeCandidate.boundSpace || removing)
			return;
		setRemoving(true);
		try {
			await client.channels.delete(removeCandidate.id);
			queryClient.setQueryData<Channel[]>(CHANNELS_KEY, (current) =>
				current?.filter((item) => item.id !== removeCandidate.id),
			);
			setRemoveCandidate(null);
		} catch (caught) {
			onNotice({
				title: t("settings.channels.removeError.title"),
				message:
					caught instanceof Error
						? caught.message
						: t("settings.channels.removeError.body"),
			});
		} finally {
			setRemoving(false);
		}
	};
	return (
		<View className="pt-4">
			{bindingChannel ? <ChannelBindingSheet key={bindingChannel.id} channel={bindingChannel} onClose={() => setBindingChannel(null)} onChanged={() => { setBindingChannel(null); void load(); }} /> : null}
			{loading ? (
				<LoadingBlock />
			) : error ? (
				<InlineError message={error} onRetry={() => void load()} />
			) : channels.length === 0 ? (
				<EmptyState
					icon="messages"
					title={t("settings.channels.empty.title")}
					action={{ icon: "plus", label: t("settings.channels.add"), onPress: () => router.push("/settings/new-channel") }}
				/>
			) : (
				<>
					<SettingsGroup>
						{channels.map((channel, index) => (
							<View key={channel.id} className="min-h-13 flex-row items-center gap-3 bg-surface py-2 pl-4 pr-1">
								<GroupTile><View className={`size-2 rounded-full ${channelHealthState(channel) === "ready" ? "bg-success" : "bg-warning"}`} /></GroupTile>
								<View className="min-w-0 flex-1 gap-0.5">
									<Text numberOfLines={1} className="text-body text-fg">{channel.name}</Text>
									<Text className="text-caption text-fg-muted">
										{channel.provider} · {t(`settings.channels.health.${channelHealthState(channel)}`)}
									</Text>
									{channel.boundSpace ? <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: channel.boundSpace!.id } })} className="min-h-11 justify-center active:opacity-60">
										<Text className="text-caption text-accent">{t("settings.channels.boundTo", { name: channel.boundSpace.title || channel.boundSpace.id.slice(0, 8) })}</Text>
									</Pressable> : null}
									{channel.health?.message || channel.health?.detail ? <Text selectable className="text-caption text-fg-muted">{channel.health.message || channel.health.detail}</Text> : null}
								</View>
								<IconButton name="settings" label={t(channel.boundSpace ? "settings.channels.unbind" : "settings.channels.bind")} onPress={() => setBindingChannel(channel)} />
								{!channel.boundSpace ? (
									<IconButton
										name="trash"
										label={t("settings.channels.remove", { name: channel.name })}
										tone="danger"
										onPress={() => setRemoveCandidate(channel)}
									/>
								) : null}
								{index < channels.length - 1 ? <GroupSeparator /> : null}
							</View>
						))}
					</SettingsGroup>
					<ConfirmSheet
						visible={removeCandidate !== null}
						title={t("settings.channels.removeSheet.title")}
						subtitle={removeCandidate?.name}
						message={t("settings.channels.removeSheet.body")}
						confirmLabel={t("common.remove")}
						confirmIcon="trash"
						showCancel
						busy={removing}
						onConfirm={() => void confirmRemove()}
						onClose={() => setRemoveCandidate(null)}
						testID="settings-remove-channel-sheet"
					/>
				</>
			)}
		</View>
	);
}

function BillingSection({
	client,
	onNotice,
}: {
	client: CohubClient | null;
	onNotice: (notice: { title: string; message: string }) => void;
}) {
	const { t } = useTranslation();
	const query = useScreenQuery({
		queryKey: ["billing", "overview"],
		queryFn: async (): Promise<{ credits: BillingCreditStatus; catalog: BillingCatalog }> => {
			const [credits, catalogResult] = await Promise.all([client!.billing.getCredits(), client!.billing.getCatalog()]);
			return { credits, catalog: catalogResult.catalog };
		},
		enabled: Boolean(client),
	});
	const credits = query.data?.credits ?? null;
	const catalog = query.data?.catalog ?? null;
	const loading = Boolean(client) && query.isPending;
	const error = !client ? t("settings.billing.connect") : query.error ? query.error.message || t("settings.billing.error") : null;
	const load = () => query.refetch();
	const [pendingProductKey, setPendingProductKey] = useState<string | null>(null);
	const openProduct = async (
		product: BillingCatalog["plans"][number] | BillingCatalog["addons"][number],
	) => {
		if (!client || pendingProductKey) return;
		setPendingProductKey(product.key);
		try {
			const result =
				product.kind === "plan"
					? await client.billing.createSubscription(product.key)
					: await client.billing.createOrder(product.key);
			const checkout = result.checkout;
			if (!checkout.checkoutUrl) {
				onNotice({
					title: t("settings.billing.checkoutUnavailable.title"),
					message:
						checkout.message ||
						t("settings.billing.checkoutUnavailable.body"),
				});
				return;
			}
			await openWebLink(checkout.checkoutUrl);
		} catch (caught) {
			onNotice({
				title: t("settings.billing.checkoutUnavailable.title"),
				message:
					caught instanceof Error ? caught.message : t("settings.billing.checkoutError"),
			});
		} finally {
			setPendingProductKey(null);
		}
	};
	const plans = catalog?.plans ?? [];
	const addons = catalog?.addons ?? [];
	const price = (amountUsd: number) => <Text className="text-subhead tabular-nums text-fg-muted">{formatUsd(amountUsd)}</Text>;
	return (
		<View className="pt-4">
			{loading ? (
				<LoadingBlock />
			) : error ? (
				<InlineError message={error} onRetry={() => void load()} />
			) : (
				<>
					<SettingsGroup>
						<View className="p-4">
							<Text className="text-caption text-fg-muted">{t("settings.billing.balance")}</Text>
							<Text className={`mt-1 text-display tabular-nums ${credits && credits.netUsd < 0 ? "text-danger" : "text-fg"}`}>
								{formatUsd(credits?.netUsd ?? 0)}
							</Text>
						</View>
					</SettingsGroup>
					<SettingsGroup label={t("settings.billing.plans")}>
						{plans.map((plan, index) => (
							<SettingsRow
								key={plan.key}
								icon="zap"
								title={plan.name}
								value={plan.description || t("settings.billing.planFallback")}
								disabled={pendingProductKey !== null}
								onPress={() => void openProduct(plan)}
								external
								last={index === plans.length - 1}
							>{price(plan.pricing.amountUsd)}</SettingsRow>
						))}
						{plans.length === 0 ? <Text className="p-4 text-body text-fg-muted">{t("settings.billing.noPlans")}</Text> : null}
					</SettingsGroup>
					{addons.length > 0 ? (
						<SettingsGroup label={t("settings.billing.creditPackages")}>
							{addons.map((addon, index) => (
								<SettingsRow
									key={addon.key}
									icon="zap"
									title={addon.name}
									value={addon.description || t("settings.billing.addonFallback")}
									disabled={pendingProductKey !== null}
									onPress={() => void openProduct(addon)}
									external
									last={index === addons.length - 1}
								>{price(addon.pricing.amountUsd)}</SettingsRow>
							))}
						</SettingsGroup>
					) : null}
				</>
			)}
		</View>
	);
}

function ReferralsSection({
	client,
	onNotice,
}: {
	client: CohubClient | null;
	onNotice: (notice: { title: string; message: string }) => void;
}) {
	const { t } = useTranslation();
	const { data, loading, rotating, error, load, rotate } = useReferrals(client);
	const [rotateOpen, setRotateOpen] = useState(false);
	const share = async () => {
		if (!data) return;
		const url = `https://cohub.live/referrals/${data.code}`;
		try {
			await Share.share({ title: t("settings.referrals.shareTitle"), message: url });
		} catch {
			onNotice({
				title: t("settings.referrals.shareUnavailable.title"),
				message: t("settings.referrals.shareUnavailable.body"),
			});
		}
	};
	const link = data ? `https://cohub.live/referrals/${data.code}` : "";
	const copy = () => void Clipboard.setStringAsync(link)
		.then(() => onNotice({ title: t("settings.referrals.copy"), message: t("settings.referrals.copied") }))
		.catch((caught: unknown) => onNotice({ title: t("settings.referrals.copy"), message: caught instanceof Error ? caught.message : t("settings.referrals.error") }));
	return (
		<View className="pt-4">
			{loading ? (
				<LoadingBlock />
			) : !data ? (
				<InlineError message={error || t("settings.referrals.unavailable")} onRetry={() => void load()} />
			) : (
				<>
					<SettingsGroup label={t("settings.referrals.link")}>
						<View className="px-4 py-3">
							<Text selectable className="text-body text-fg">{link}</Text>
						</View>
					</SettingsGroup>
					<SettingsGroup>
						<GroupRow leading={<GroupTile icon="copy" accent />} title={t("settings.referrals.copy")} titleClassName="text-accent" disabled={rotating} onPress={copy} />
						<GroupRow leading={<GroupTile icon="share" accent />} title={t("settings.referrals.share")} titleClassName="text-accent" disabled={rotating} onPress={() => void share()} />
						<GroupRow leading={rotating ? <GroupSlot><Loader /></GroupSlot> : <GroupTile icon="refresh" accent />} title={t("settings.referrals.rotate")} titleClassName="text-accent" disabled={rotating} onPress={() => setRotateOpen(true)} last />
					</SettingsGroup>
					{error && !rotateOpen ? <Text accessibilityRole="alert" className="-mt-4 mb-6 px-8 text-caption text-danger">{error}</Text> : null}
					<ConfirmSheet visible={rotateOpen} title={t("settings.referrals.rotate")} message={t("settings.referrals.rotateConfirm")} confirmLabel={t("settings.referrals.rotate")} confirmIcon="refresh" busy={rotating} error={error} onConfirm={() => void rotate().then((ok) => { if (ok) setRotateOpen(false); })} onClose={() => setRotateOpen(false)} />
					<View className="flex-row gap-2 px-4 pb-6">
						<Metric label={t("settings.referrals.rewarded")} value={String(data.summary.rewarded)} icon="check-circle" />
						<Metric label={t("settings.referrals.earned")} value={formatUsd(data.summary.earnedUsd)} icon="gift" />
					</View>
					<SettingsGroup label={t("settings.referrals.recent")}>
						{data.items.map((item, index) => (
							<SettingsRow
								key={item.id}
								icon="user"
								title={item.profile?.displayName || t("settings.profile.fallbackName")}
								value={formatRelativeTime(item.claimedAt)}
								last={index === data.items.length - 1}
							>
								<StatusPill label={item.status} tone={item.status === "rewarded" ? "success" : "neutral"} />
							</SettingsRow>
						))}
						{data.items.length === 0 ? <Text className="p-4 text-body text-fg-muted">{t("settings.referrals.none")}</Text> : null}
					</SettingsGroup>
				</>
			)}
		</View>
	);
}

function Metric({ label, value, icon }: { label: string; value: string; icon: IconName }) {
	return (
		<View className="min-h-20 flex-1 rounded-md bg-surface p-3" style={CONTINUOUS}>
			<AppIcon name={icon} size={16} tone="accent" />
			<Text numberOfLines={1} className="mt-2 text-headline font-semibold tabular-nums text-fg">{value}</Text>
			<Text numberOfLines={1} className="mt-0.5 text-caption text-fg-muted">{label}</Text>
		</View>
	);
}

function LoadingBlock() {
	const { t } = useTranslation();
	return <LoadingState fill={false} label={t("settings.loading")} />;
}

/** Shown in place of a section that failed to load; save errors stay beside their form instead. */
function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
	return <DataError message={message} onRetry={onRetry} />;
}

const CONTINUOUS = { borderCurve: "continuous" } as const;
const RULES_PREVIEW = { maxHeight: 360 } as const;
const MONO = { fontFamily: "SpaceMono" } as const;
