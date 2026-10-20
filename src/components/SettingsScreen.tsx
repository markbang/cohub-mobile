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
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
	ActivityIndicator,
	Linking,
	Platform,
	Pressable,
	ScrollView,
	Share,
	Text,
	TextInput,
	View,
} from "react-native";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { BrowserSettings } from "@/src/components/BrowserSettings";
import { ChatFilterSettings } from "@/src/components/ChatFilterSettings";
import { ChannelBindingSheet } from "@/src/components/ChannelBindingSheet";
import { channelHealthState } from "@/src/data/channel-settings";
import { useUserRules } from "@/src/data/use-user-rules";
import { useReferrals } from "@/src/data/use-referrals";
import { useProfileSession } from "@/src/auth/profile-session";
import { useApp } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { settingsSections, type SettingsSection } from "@/src/data/settings-navigation";
import {
	registerForPushNotifications,
	type PushRegistrationResult,
} from "@/src/platform/notifications";
import { useAppTheme, typography } from "@/src/theme";
import {
	AppIcon,
	Avatar,
	FIELD_INPUT_CLASS,
	TopBar,
	EmptyState,
	IconButton,
	PrimaryButton,
	Screen,
	SectionHeader,
	StatusPill,
} from "@/src/ui";
import { formatNumber, formatRelativeTime } from "@/src/utils";
import { openWebLink } from "@/src/platform/browser";

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
	const { client, installationId, getAccessToken } = useApp();
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
				{section === "chats" ? <ChatFilterSettings /> : null}
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
			<AdaptiveSheet
				visible={notice !== null}
				title={notice?.title ?? t("common.notice")}
				onClose={() => setNotice(null)}
				scrollable={false}
				footer={
					<View className="items-end">
						<PrimaryButton
							label={t("common.done")}
							onPress={() => setNotice(null)}
							className="min-h-11 px-4"
						/>
					</View>
				}
				testID="settings-notice-sheet"
			>
				<Text className="text-body text-fg-secondary">
					{notice?.message ?? ""}
				</Text>
			</AdaptiveSheet>
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
					size={17}
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
	const [data, setData] = useState<ProfileState>({
		profile: null,
		email: null,
		uuid: "",
	});
	const [displayName, setDisplayName] = useState("");
	const [username, setUsername] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [uploadingAvatar, setUploadingAvatar] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!client) {
			setLoading(false);
			setError(t("settings.profile.connect"));
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const [me, claims] = await Promise.all([
				client.user.getMe(),
				getClaims(),
			]);
			const profile = me.profile;
			setData({
				profile,
				email:
					me.email ?? (typeof claims.email === "string" ? claims.email : null),
				uuid: me.uuid,
			});
			setDisplayName(profile.displayName);
			setUsername(profile.username ?? "");
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : t("settings.profile.loadError"),
			);
		} finally {
			setLoading(false);
		}
	}, [client, getClaims, t]);

	useEffect(() => {
		void Promise.resolve().then(() => load());
	}, [load]);

	const changeAvatar = async () => {
		if (!client || uploadingAvatar) return;
		setUploadingAvatar(true);
		setError(null);
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
			setData((current) => ({ ...current, profile: updated.profile }));
			onNotice({
				title: t("settings.profile.avatarUpdated.title"),
				message: t("settings.profile.avatarUpdated.body"),
			});
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : t("settings.profile.avatarError"),
			);
		} finally {
			setUploadingAvatar(false);
		}
	};

	const save = async () => {
		if (!client || saving || !displayName.trim()) return;
		setSaving(true);
		setError(null);
		try {
			const result = await client.user.updateProfile({
				displayName: displayName.trim(),
				username: username.trim() || null,
			});
			setData((current) => ({ ...current, profile: result.profile }));
			setDisplayName(result.profile.displayName);
			setUsername(result.profile.username ?? "");
			onNotice({
				title: t("settings.profile.updated.title"),
				message: t("settings.profile.updated.body"),
			});
		} catch (caught) {
			setError(
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
								className="flex-row items-center gap-1.5 mt-2"
							>
								<ActivityIndicator size="small" color={theme.colors.accent} />
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
							className="text-micro font-semibold text-fg-faint mt-1.5"
						>
							{t("settings.profile.tapAvatar")}
						</Text>
					</View>
					<SettingsGroup>
						<View className="p-4">
							<Text
								className="text-caption text-fg-secondary mb-1.5"
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
								className="text-caption text-fg-secondary mt-4 mb-1.5"
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
	const [data, setData] = useState<UserActivityResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const generation = useRef(0);
	const load = useCallback(async () => {
		const request = ++generation.current;
		if (!client) {
			setLoading(false);
			setError(t("settings.activity.connect"));
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const result = await client.user.getActivity({ days });
			if (request === generation.current) setData(result);
		} catch (caught) {
			if (request === generation.current) setError(
				caught instanceof Error ? caught.message : t("settings.activity.error"),
			);
		} finally {
			if (request === generation.current) setLoading(false);
		}
	}, [client, days, t]);
	useEffect(() => {
		let active = true;
		void Promise.resolve().then(() => { if (active) void load(); });
		return () => { active = false; generation.current += 1; };
	}, [load]);
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
	const { data, configSpace, loading, creating, error, load, openConfig } = useUserRules();
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
							<AppIcon name="file-text" size={17} tone="accent" />
							<Text
								className="text-body font-semibold text-fg"
							>
								/configs/user/AGENTS.md
							</Text>
						</View>
						<Text
							className="text-caption text-fg-muted mt-1.5"
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
						<PrimaryButton label={t(configSpace ? "settings.rules.openConfig" : "settings.rules.createConfig")} icon={configSpace ? "arrow-right" : "plus"} loading={creating} className="mt-4" onPress={() => void openConfig().then((space) => { if (space) router.push({ pathname: "/space/[spaceId]", params: { spaceId: space.id } }); })} />
					</View>
				</SettingsGroup>
			)}
		</View>
	);
}

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
	const [channels, setChannels] = useState<Channel[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [removeCandidate, setRemoveCandidate] = useState<Channel | null>(null);
	const [removing, setRemoving] = useState(false);
	const load = useCallback(async () => {
		if (!client) {
			setLoading(false);
			setError(t("settings.channels.connect"));
			return;
		}
		setLoading(true);
		setError(null);
		try {
			setChannels(await client.channels.list());
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : t("settings.channels.error"),
			);
		} finally {
			setLoading(false);
		}
	}, [client, t]);
	useFocusEffect(useCallback(() => {
		void load();
	}, [load]));
	const confirmRemove = async () => {
		if (!client || !removeCandidate || removeCandidate.boundSpace || removing)
			return;
		setRemoving(true);
		try {
			await client.channels.delete(removeCandidate.id);
			setChannels((current) =>
				current.filter((item) => item.id !== removeCandidate.id),
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
				<IconButton name="refresh" label={t("common.refresh")} disabled={loading} onPress={() => void load()} />
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
					<AdaptiveSheet
						visible={removeCandidate !== null}
						title={t("settings.channels.removeSheet.title")}
						subtitle={removeCandidate?.name}
						onClose={() => {
							if (!removing) setRemoveCandidate(null);
						}}
						dismissible={!removing}
						scrollable={false}
						testID="settings-remove-channel-sheet"
						footer={
							<View
								className="flex-row justify-end gap-2"
							>
								<Pressable
									disabled={removing}
									onPress={() => setRemoveCandidate(null)}
									className="min-h-12 px-4 justify-center"
								>
									<Text
										className="text-body font-semibold text-fg-secondary"
									>
										{t("common.cancel")}
									</Text>
								</Pressable>
								<PrimaryButton
									label={t("common.remove")}
									icon="trash"
									variant="danger"
									loading={removing}
									onPress={() => void confirmRemove()}
									className="min-h-12 px-4"
								/>
							</View>
						}
					>
						<Text
							className="text-body text-fg-secondary"
						>
							{t("settings.channels.removeSheet.body")}
						</Text>
					</AdaptiveSheet>
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
	const [credits, setCredits] = useState<BillingCreditStatus | null>(null);
	const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pendingProductKey, setPendingProductKey] = useState<string | null>(null);
	const load = useCallback(async () => {
		if (!client) {
			setLoading(false);
			setError(t("settings.billing.connect"));
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const [credit, catalogResult] = await Promise.all([
				client.billing.getCredits(),
				client.billing.getCatalog(),
			]);
			setCredits(credit);
			setCatalog(catalogResult.catalog);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : t("settings.billing.error"),
			);
		} finally {
			setLoading(false);
		}
	}, [client, t]);
	useEffect(() => {
		void Promise.resolve().then(() => load());
	}, [load]);
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
										marginTop: 5,
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
			await Share.share({ title: t("settings.referrals.shareTitle"), message: url });
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
							<AdaptiveSheet visible={rotateOpen} title={t("settings.referrals.rotate")} onClose={() => { if (!rotating) setRotateOpen(false); }} dismissible={!rotating} scrollable={false} footer={<PrimaryButton label={t("settings.referrals.rotate")} icon="refresh" variant="danger" loading={rotating} onPress={() => void rotate().then((ok) => { if (ok) setRotateOpen(false); })} />}>
								<Text className="text-body text-fg">{t("settings.referrals.rotateConfirm")}</Text>
								{error ? <Text accessibilityRole="alert" className="text-caption text-danger mt-3">{error}</Text> : null}
							</AdaptiveSheet>
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
	const theme = useAppTheme();
	const { t } = useTranslation();
	return (
		<View
			className="min-h-48 items-center justify-center"
		>
			<ActivityIndicator size="small" color={theme.colors.accent} />
			<Text
				className="text-caption text-fg-muted mt-2"
			>
				{t("settings.loading")}
			</Text>
		</View>
	);
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

function formatUsd(value: number) {
	if (!Number.isFinite(value)) return "$0.00";
	return `$${value.toFixed(2)}`;
}
