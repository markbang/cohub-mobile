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
import { useState, type ReactNode } from "react";
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
import { useAppTheme, typography } from "@/src/theme";
import { AppIcon, Avatar, EmptyState, FIELD_INPUT_CLASS, IconButton, Loader, LoadingState, PrimaryButton, Screen, SectionHeader, StatusPill, TopBar } from "@/src/ui";
import { formatNumber, formatRelativeTime } from "@/src/utils";
import { openWebLink } from "@/src/platform/browser";
import { formatUsd } from "@/src/data/space-wallet";
import { withForegroundHandoff } from "@/src/platform/app-lifecycle";

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
	const [notice, setNotice] = useState<{
		title: string;
		message: string;
	} | null>(null);

	return (
		<Screen keyboard>
			<TopBar
				title={t(settingsSections[section].labelKey)}
				onBack={() => router.back()}
				actions={section === "channels" ? <IconButton name="plus" label={t("settings.channels.add")} onPress={() => router.push("/settings/new-channel")} /> : undefined}
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

function SettingsGroup({ children }: { children: ReactNode }) {
	return (
		<View
			className="mt-3 border-t border-b border-border bg-surface"
		>
			{children}
		</View>
	);
}

function SettingsRow({
	icon,
	title,
	detail,
	trailing,
	onPress,
	danger = false,
	disabled = false,
}: {
	icon: React.ComponentProps<typeof AppIcon>["name"];
	title: string;
	detail?: string;
	trailing?: ReactNode;
	onPress?: () => void;
	danger?: boolean;
	disabled?: boolean;
}) {
	const theme = useAppTheme();
	const content = (
		<View
			className="min-h-16 px-3 py-2 flex-row items-center gap-3 border-b border-border"
		>
			<View
				style={{
					width: 34,
					height: 34,
					borderRadius: 10,
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: danger
						? theme.colors.dangerSoft
						: theme.colors.surfaceRaised,
				}}
			>
				<AppIcon
					name={icon}
					size={18}
					tone={danger ? "danger" : "muted"}
				/>
			</View>
			<View className="flex-1 min-w-0">
				<Text
					style={[
						typography.bodyMedium,
						{ color: danger ? theme.colors.danger : theme.colors.text },
					]}
				>
					{title}
				</Text>
				{detail ? (
					<Text
						numberOfLines={2}
						className="text-caption text-fg-muted mt-0.5"
					>
						{detail}
					</Text>
				) : null}
			</View>
			{trailing}
		</View>
	);
	return onPress ? (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={title}
			disabled={disabled}
			onPress={onPress}
			className="active:bg-surface-pressed disabled:opacity-55"
		>
			{content}
		</Pressable>
	) : (
		content
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
				await withForegroundHandoff(() => ImagePicker.requestMediaLibraryPermissionsAsync());
			if (!permission.granted) {
				onNotice({
					title: t("settings.profile.photoOff.title"),
					message: t("settings.profile.photoOff.body"),
				});
				return;
			}
			const result = await withForegroundHandoff(() => ImagePicker.launchImageLibraryAsync({
				mediaTypes: ["images"],
				quality: 0.9,
			}));
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
		<View>
			{loading && !data.profile ? (
				<LoadingBlock />
			) : error && !data.profile ? (
				<InlineError message={error} onRetry={() => void load()} />
			) : (
				<>
					<View
						className="items-center pt-4 pb-2"
					>
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
							<View
								className="flex-row items-center gap-2 mt-2"
							>
								<Loader />
								<Text
									className="text-caption text-fg-muted"
								>
									{t("settings.profile.uploadingAvatar")}
								</Text>
							</View>
						) : null}
						<Text className={`text-headline font-semibold text-fg ${uploadingAvatar ? "mt-2" : "mt-3"}`}>
							{data.profile?.displayName || t("settings.profile.fallbackName")}
						</Text>
						{data.email ? (
							<Text
								className="text-caption text-fg-muted mt-1"
							>
								{data.email}
							</Text>
						) : null}
						<Text
							className="text-micro font-semibold text-fg-faint mt-2"
						>
							{t("settings.profile.tapAvatar")}
						</Text>
					</View>
					<SettingsGroup>
						<View className="p-4">
							<Text
								className="text-caption text-fg-secondary mb-2"
							>
								{t("settings.profile.displayName")}
							</Text>
							<TextInput
								value={displayName}
								onChangeText={setDisplayName}
								maxLength={120}
								placeholder={t("settings.profile.displayNamePlaceholder")}
								placeholderTextColor={theme.colors.textFaint}
								className={FIELD_INPUT_CLASS}
							/>
							<Text
								className="text-caption text-fg-secondary mt-4 mb-2"
							>
								{t("settings.profile.username")}
							</Text>
							<TextInput
								value={username}
								onChangeText={setUsername}
								maxLength={39}
								autoCapitalize="none"
								placeholder={t("settings.profile.usernamePlaceholder")}
								placeholderTextColor={theme.colors.textFaint}
								className={FIELD_INPUT_CLASS}
							/>
							{error ? <Text accessibilityRole="alert" selectable className="text-caption text-danger mt-3">{error}</Text> : null}
							<PrimaryButton
								label={saving ? t("settings.profile.saving") : t("settings.profile.save")}
								icon="check"
								loading={saving}
								disabled={!displayName.trim()}
								onPress={() => void save()}
								className="mt-4"
							/>
						</View>
					</SettingsGroup>
					<SectionHeader title={t("settings.profile.section.identity")} />
					<SettingsGroup>
						<SettingsRow
							icon="fingerprint"
							title={t("settings.profile.userId")}
							detail={data.uuid || t("settings.profile.unavailable")}
							trailing={null}
						/>
						<SettingsRow
							icon="user"
							title={t("settings.profile.username")}
							detail={username ? `@${username}` : t("settings.profile.notSet")}
							trailing={null}
						/>
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
	return (
		<View>
			<View
				className="flex-row gap-2 px-4 pt-2"
			>
				{[7, 30, 365].map((value) => (
					<Pressable
						key={value}
						accessibilityRole="button"
						accessibilityState={{ selected: days === value }}
						onPress={() => setDays(value)}
						className={`min-h-12 justify-center`}
					>
						{({ pressed }) => <View className={`min-h-8 justify-center overflow-hidden rounded-full px-3 py-1 ${pressed ? "bg-surface-pressed" : days === value ? "bg-accent-soft" : ""}`}>
						<Text className={`text-subhead font-semibold ${days === value ? "text-accent" : "text-fg-muted"}`}>
							{value === 365 ? t("settings.activity.range.oneYear") : t("settings.activity.range.days", { days: value })}
						</Text></View>}
					</Pressable>
				))}
			</View>
			{loading ? (
				<LoadingBlock />
			) : error ? (
				<InlineError message={error} onRetry={() => void load()} />
			) : (
				<>
					<View
						className="flex-row gap-2 px-4 pt-4"
					>
						<Metric
							label={t("settings.activity.metric.tokens")}
							value={formatNumber(summary?.totalTokens)}
							icon="layers"
						/>
						<Metric
							label={t("settings.activity.metric.requests")}
							value={formatNumber(summary?.requestCount)}
							icon="zap"
						/>
						<Metric
							label={t("settings.activity.metric.success")}
							value={formatNumber(summary?.successCount)}
							icon="check-circle"
						/>
					</View>
					<SectionHeader title={t("settings.activity.topModels")} />
					<SettingsGroup>
						{(data?.rankings.llmModels ?? []).slice(0, 8).map((item, index) => (
							<View
								key={`${item.provider}/${item.model}`}
								className="min-h-14 px-3 flex-row items-center gap-2 border-b border-border"
							>
								<Text
									className="text-caption w-6 text-fg-faint"
								>
									{index + 1}
								</Text>
								<View className="flex-1 min-w-0">
									<Text
										numberOfLines={1}
										className="text-body font-semibold text-fg"
									>
										{item.model}
									</Text>
									<Text
										numberOfLines={1}
										className="text-micro font-semibold text-fg-muted mt-0.5"
									>
										{item.provider}
									</Text>
								</View>
								<Text
									className="text-caption text-fg-secondary"
								>
									{formatNumber(item.totalTokens)}
								</Text>
							</View>
						))}
						{(data?.rankings.llmModels ?? []).length === 0 ? (
							<Text
								className="text-body text-fg-muted p-4"
							>
								{t("settings.activity.noUsage")}
							</Text>
						) : null}
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
	return (
		<View>
			<SettingsGroup>
				<SettingsRow
					icon="bell"
					title={t("settings.notifications.row.title")}
					detail={
						result?.message ??
						t("settings.notifications.row.detail")
					}
					trailing={
						<StatusPill
							label={status}
							tone={
								result?.status === "enabled"
									? "success"
									: result?.status === "unavailable"
										? "warning"
										: "neutral"
							}
						/>
					}
				/>
				<View className="p-4">
					<PrimaryButton
						label={loading ? t("settings.notifications.checking") : t("settings.notifications.enable")}
						icon="bell"
						loading={loading}
						onPress={() => void enable()}
						className="min-h-12"
					/>
					{result?.status === "unavailable" &&
					result.reason === "permission-denied" ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={t("settings.notifications.openSystem")}
							onPress={() => void Linking.openSettings()}
							className="mt-3 active:opacity-60"
						>
							<Text
								className="text-body font-semibold text-accent"
							>
								{t("settings.notifications.openSystem")}
							</Text>
						</Pressable>
					) : null}
					<Text
						className="text-caption text-fg-muted mt-2"
					>
						{t("settings.notifications.androidNote")}
					</Text>
				</View>
			</SettingsGroup>
			<SectionHeader title={t("settings.notifications.section.device")} />
			<SettingsGroup>
				<SettingsRow
					icon="fingerprint"
					title={t("settings.notifications.installation")}
					detail={
						installationId
							? `${installationId.slice(0, 8)}…`
							: t("settings.notifications.preparingIdentity")
					}
				/>
				<SettingsRow
					icon="wifi"
					title={t("settings.notifications.delivery")}
					detail={
						client ? t("settings.notifications.connected") : t("settings.notifications.waiting")
					}
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
		<View>
			{loading ? (
				<LoadingBlock />
			) : error ? (
				<InlineError message={error} onRetry={() => void load()} />
			) : (
				<SettingsGroup>
					<View className="p-4">
						<View
							className="flex-row items-center gap-2"
						>
							<AppIcon name="file-text" size={18} tone="accent" />
							<Text
								className="text-body font-semibold text-fg"
							>
								{data?.path || "AGENTS.md"}
							</Text>
						</View>
						<Text
							className="text-caption text-fg-muted mt-2"
						>
							{data?.updatedAt
								? t("settings.rules.updated", { time: formatRelativeTime(data.updatedAt) })
								: t("settings.rules.notPublished")}
						</Text>
						<ScrollView
							horizontal={false}
							style={{ maxHeight: 360, marginTop: 13 }}
						>
							<Text selectable className="text-code text-fg-secondary" style={{ fontFamily: "SpaceMono" }}>
								{data?.content?.trim() || t("settings.rules.none")}
							</Text>
						</ScrollView>
						<Text className="text-caption text-fg-muted mt-4">{t("settings.rules.homeHint", { file: "AGENTS.md" })}</Text>
						<PrimaryButton label={t("settings.rules.openHome")} icon="arrow-right" loading={opening} className="mt-3" onPress={() => void openHome().then((space) => { if (space) router.push({ pathname: "/space/[spaceId]", params: { spaceId: space.id } }); })} />
						{openError ? <Text accessibilityRole="alert" selectable className="text-caption text-danger mt-2">{openError}</Text> : null}
					</View>
				</SettingsGroup>
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
	const theme = useAppTheme();
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
		<View>
			{bindingChannel ? <ChannelBindingSheet key={bindingChannel.id} channel={bindingChannel} onClose={() => setBindingChannel(null)} onChanged={() => { setBindingChannel(null); void load(); }} /> : null}
			<View className="px-4 items-end">
				<IconButton name="refresh" label={t("common.refresh")} disabled={query.isFetching} onPress={() => void load()} />
			</View>
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
						{channels.map((channel) => (
							<View
								key={channel.id}
								className="min-h-20 px-3 py-3 flex-row items-center gap-2 border-b border-border"
							>
								<View
									className="w-9 h-9 rounded-sm items-center justify-center bg-surface-raised"
								>
									<View
										style={{
											width: 8,
											height: 8,
											borderRadius: 4,
											backgroundColor:
												channelHealthState(channel) === "ready"
													? theme.colors.success
													: theme.colors.warning,
										}}
									/>
								</View>
								<View className="flex-1 min-w-0">
									<Text
										numberOfLines={1}
										className="text-body font-semibold text-fg"
									>
										{channel.name}
									</Text>
									<Text
										className="text-caption text-fg-muted mt-0.5"
									>
										{channel.provider} · {t(`settings.channels.health.${channelHealthState(channel)}`)}
									</Text>
									{channel.boundSpace ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: channel.boundSpace!.id } })} className="min-h-11 justify-center active:opacity-60">
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
										size={38}
										onPress={() => setRemoveCandidate(channel)}
									/>
								) : null}
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
	const theme = useAppTheme();
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
	return (
		<View>
			{loading ? (
				<LoadingBlock />
			) : error ? (
				<InlineError message={error} onRetry={() => void load()} />
			) : (
				<>
					<SettingsGroup>
						<View className="p-4">
							<Text
								className="text-caption text-fg-muted"
							>
								{t("settings.billing.balance")}
							</Text>
							<Text
								style={[
									typography.display,
									{
										color:
											credits && credits.netUsd < 0
												? theme.colors.danger
												: theme.colors.text,
										marginTop: 4,
									},
								]}
							>
								{formatUsd(credits?.netUsd ?? 0)}
							</Text>
						</View>
					</SettingsGroup>
					<SectionHeader title={t("settings.billing.plans")} />
					<SettingsGroup>
						{(catalog?.plans ?? []).map((plan) => (
							<SettingsRow
								key={plan.key}
								icon="zap"
								title={plan.name}
								detail={plan.description || t("settings.billing.planFallback")}
								disabled={pendingProductKey !== null}
								onPress={() => void openProduct(plan)}
								trailing={
									<Text
										className="text-caption text-fg-secondary"
									>
										{formatUsd(plan.pricing.amountUsd)}
									</Text>
								}
							/>
						))}
						{(catalog?.plans ?? []).length === 0 ? (
							<Text
								className="text-body text-fg-muted p-4"
							>
								{t("settings.billing.noPlans")}
							</Text>
						) : null}
					</SettingsGroup>
					{(catalog?.addons ?? []).length > 0 ? (
						<>
							<SectionHeader title={t("settings.billing.creditPackages")} />
							<SettingsGroup>
								{(catalog?.addons ?? []).map((addon) => (
									<SettingsRow
										key={addon.key}
										icon="zap"
										title={addon.name}
										detail={addon.description || t("settings.billing.addonFallback")}
										disabled={pendingProductKey !== null}
										onPress={() => void openProduct(addon)}
										trailing={
											<Text
												className="text-caption text-fg-secondary"
											>
												{formatUsd(addon.pricing.amountUsd)}
											</Text>
										}
									/>
								))}
							</SettingsGroup>
						</>
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
			await withForegroundHandoff(() => Share.share({ title: t("settings.referrals.shareTitle"), message: url }));
		} catch {
			onNotice({
				title: t("settings.referrals.shareUnavailable.title"),
				message: t("settings.referrals.shareUnavailable.body"),
			});
		}
	};
	return (
		<View>
			{loading ? (
				<LoadingBlock />
			) : !data ? (
				<InlineError
					message={error || t("settings.referrals.unavailable")}
					onRetry={() => void load()}
				/>
			) : (
				<>
					<SettingsGroup>
						<View className="p-4">
							<Text
								className="text-caption text-fg-muted"
							>
								{t("settings.referrals.link")}
							</Text>
							<Text
								selectable
								className="text-body font-semibold text-fg mt-2"
							>
								https://cohub.live/referrals/{data.code}
							</Text>
							<View className="flex-row justify-end mt-3">
								<IconButton name="copy" label={t("settings.referrals.copy")} disabled={rotating} onPress={() => void Clipboard.setStringAsync(`https://cohub.live/referrals/${data.code}`).then(() => onNotice({ title: t("settings.referrals.copy"), message: t("settings.referrals.copied") })).catch((caught: unknown) => onNotice({ title: t("settings.referrals.copy"), message: caught instanceof Error ? caught.message : t("settings.referrals.error") }))} />
								<IconButton name="share" label={t("settings.referrals.share")} disabled={rotating} onPress={() => void share()} />
								<IconButton name="refresh" label={t("settings.referrals.rotate")} disabled={rotating} onPress={() => setRotateOpen(true)} />
							</View>
							{error && !rotateOpen ? <Text accessibilityRole="alert" className="text-caption text-danger">{error}</Text> : null}
							<ConfirmSheet visible={rotateOpen} title={t("settings.referrals.rotate")} message={t("settings.referrals.rotateConfirm")} confirmLabel={t("settings.referrals.rotate")} confirmIcon="refresh" busy={rotating} error={error} onConfirm={() => void rotate().then((ok) => { if (ok) setRotateOpen(false); })} onClose={() => setRotateOpen(false)} />
						</View>
					</SettingsGroup>
					<View
						className="flex-row gap-2 px-4 pt-4"
					>
						<Metric
							label={t("settings.referrals.rewarded")}
							value={String(data.summary.rewarded)}
							icon="check-circle"
						/>
						<Metric
							label={t("settings.referrals.earned")}
							value={formatUsd(data.summary.earnedUsd)}
							icon="gift"
						/>
					</View>
					<SectionHeader title={t("settings.referrals.recent")} />
					<SettingsGroup>
						{data.items.map((item) => (
							<SettingsRow
								key={item.id}
								icon="user"
								title={item.profile?.displayName || t("settings.profile.fallbackName")}
								detail={formatRelativeTime(item.claimedAt)}
								trailing={
									<StatusPill
										label={item.status}
										tone={item.status === "rewarded" ? "success" : "neutral"}
									/>
								}
							/>
						))}
						{data.items.length === 0 ? (
							<Text
								className="text-body text-fg-muted p-4"
							>
								{t("settings.referrals.none")}
							</Text>
						) : null}
					</SettingsGroup>
				</>
			)}
		</View>
	);
}

function Metric({
	label,
	value,
	icon,
}: {
	label: string;
	value: string;
	icon: React.ComponentProps<typeof AppIcon>["name"];
}) {
	return (
		<View
			className="flex-1 min-h-20 p-3 border border-border rounded-md bg-surface"
		>
			<AppIcon name={icon} size={16} tone="accent" />
			<Text
				numberOfLines={1}
				className="text-headline font-semibold text-fg mt-2"
			>
				{value}
			</Text>
			<Text
				className="text-micro font-semibold text-fg-muted mt-0.5"
			>
				{label}
			</Text>
		</View>
	);
}

function LoadingBlock() {
	const { t } = useTranslation();
	return <LoadingState fill={false} label={t("settings.loading")} />;
}

function InlineError({
	message,
	onRetry,
}: {
	message: string;
	onRetry: () => void;
}) {
	const { t } = useTranslation();
	return (
		<View
			className="mx-4 mt-3 p-4 border border-danger rounded-md bg-danger-soft"
		>
			<Text
				selectable
				className="text-caption text-danger"
			>
				{message}
			</Text>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={t("common.retry")}
				onPress={onRetry}
				className="mt-2 self-start active:opacity-60"
			>
				<Text className="text-body font-semibold text-danger">
					{t("common.retry")}
				</Text>
			</Pressable>
		</View>
	);
}
