import type { SessionTurnIndexItem } from "@neta-art/cohub";
import { LegendList } from "@legendapp/list/react-native";
import { useMemo, useState } from "react";
import {
	Pressable,
	Text,
	View,
} from "react-native";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { turnIndexPreview } from "@/src/data/session-history";
import { useTranslation, type Translate } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { AppIcon, Loader, LoadingState, SearchField, StatusPill } from "@/src/ui";
import { formatRelativeTime } from "@/src/utils";

type TurnNavigatorSheetProps = {
	visible: boolean;
	turns: SessionTurnIndexItem[];
	currentSequence: number | null;
	loading: boolean;
	loadingSequence: number | null;
	onClose: () => void;
	onJump: (sequence: number) => void | Promise<void>;
	onRetry: () => void;
};

function statusTone(
	status: SessionTurnIndexItem["status"],
): "success" | "warning" | "danger" | "neutral" {
	if (status === "failed") return "danger";
	if (
		status === "running" ||
		status === "queued" ||
		status === "abort_requested"
	)
		return "warning";
	if (status === "interrupted" || status === "cancelled") return "neutral";
	return "success";
}

function statusLabel(status: SessionTurnIndexItem["status"], t: Translate) {
	if (status === "completed") return t("ui.status.done");
	if (status === "failed") return t("ui.status.failed");
	if (status === "running") return t("ui.status.running");
	if (status === "queued") return t("ui.status.queued");
	if (status === "interrupted" || status === "cancelled") return t("ui.status.stopped");
	return status;
}

function turnPreview(turn: SessionTurnIndexItem, t: Translate) {
	if (turn.intent === "compact") return t("message.compaction.title");
	return turnIndexPreview(turn);
}

export function TurnNavigatorSheet({
	visible,
	turns,
	currentSequence,
	loading,
	loadingSequence,
	onClose,
	onJump,
	onRetry,
}: TurnNavigatorSheetProps) {
	const theme = useAppTheme();
	const { t } = useTranslation();
	const [query, setQuery] = useState("");
	const filteredTurns = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return turns;
		return turns.filter((turn) => {
			return [
				String(turn.sequence),
				`#${turn.sequence}`,
				turnPreview(turn, t),
				turn.provider ?? "",
				turn.model ?? "",
				turn.authorProfile?.displayName ?? "",
			].some((value) => value.toLowerCase().includes(needle));
		});
	}, [query, t, turns]);

	// LegendList memoizes each row on [item, extraData]; selection and jump feedback
	// live outside `data`, so they must flow through extraData to reach the rows.
	const rowExtraData = useMemo(
		() => ({ currentSequence, loadingSequence, t, theme }),
		[currentSequence, loadingSequence, t, theme],
	);

	return (
		<AdaptiveSheet
			visible={visible}
			title={t("turn.navigator.title")}
			subtitle={
				turns.length > 0
					? t("turn.navigator.subtitle", { count: turns.length })
					: t("turn.navigator.subtitleEmpty")
			}
			onClose={onClose}
			scrollable={false}
			contentStyle={{ flex: 1, minHeight: 0 }}
			fullHeight
			testID="chat-turn-navigator-sheet"
		>
			<SearchField
				value={query}
				onChangeText={setQuery}
				placeholder={t("turn.navigator.search")}
			/>
			{loading && turns.length === 0 ? (
				<View style={styles.state}>
					<LoadingState fill={false} label={t("turn.navigator.loading")} />
				</View>
			) : filteredTurns.length === 0 ? (
				<View style={styles.state}>
					<AppIcon
						name={query ? "search" : "messages"}
						size={25}
						tone="muted"
					/>
					<Text
						className="text-body text-fg-muted text-center mt-2"
					>
						{query
							? t("turn.navigator.noMatch")
							: t("turn.navigator.unavailable")}
					</Text>
					{!query ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={t("turn.navigator.retry")}
							onPress={onRetry}
							className="mt-3 active:opacity-60"
						>
							<Text
								className="text-body font-semibold text-accent"
							>
								{t("common.retry")}
							</Text>
						</Pressable>
					) : null}
				</View>
			) : (
				<LegendList
					estimatedItemSize={64}
					extraData={rowExtraData}
					data={filteredTurns}
					keyExtractor={(turn) => `${turn.sequence}:${turn.id}`}
					style={{ flex: 1, minHeight: 0, marginTop: 8 }}
					contentContainerStyle={{ paddingBottom: 12 }}
					keyboardShouldPersistTaps="handled"
					renderItem={({ item: turn }) => {
						const selected = turn.sequence === currentSequence;
						const preview = turnPreview(turn, t);
						return (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={t("turn.navigator.jump", { sequence: turn.sequence })}
								accessibilityState={{ selected }}
								disabled={loadingSequence !== null}
								onPress={() => void onJump(turn.sequence)}
								className={`mb-1 min-h-18 flex-row items-center gap-2 rounded-sm px-2.5 py-2 ${selected ? "bg-accent-soft" : "active:bg-surface-pressed"} ${loadingSequence !== null && loadingSequence !== turn.sequence ? "opacity-55" : ""}`}
							>
								<View style={styles.sequence}>
									<Text className={`text-caption tabular-nums ${selected ? "text-accent" : "text-fg-faint"}`}>
										#{turn.sequence}
									</Text>
								</View>
								<View style={styles.rowText}>
									<Text
										numberOfLines={3}
										className="text-body text-fg"
									>
										{preview}
									</Text>
									<View style={styles.meta}>
										<Text
											numberOfLines={1}
											className="text-micro font-semibold text-fg-faint flex-1"
										>
											{formatRelativeTime(turn.createdAt)}
											{turn.provider ? ` · ${turn.provider}` : ""}
											{turn.model ? ` · ${turn.model}` : ""}
										</Text>
										<StatusPill
											label={statusLabel(turn.status, t)}
											tone={statusTone(turn.status)}
										/>
									</View>
								</View>
								{loadingSequence === turn.sequence ? (
									<Loader />
								) : selected ? (
									<AppIcon name="check" size={17} tone="accent" />
								) : (
									<AppIcon
										name="chevron-right"
										size={16}
										tone="faint"
									/>
								)}
							</Pressable>
						);
					}}
				/>
			)}
		</AdaptiveSheet>
	);
}

const styles = {
	state: {
		minHeight: 220,
		alignItems: "center" as const,
		justifyContent: "center" as const,
		paddingHorizontal: 24,
	},
	sequence: {
		width: 38,
		alignSelf: "stretch" as const,
		justifyContent: "flex-start" as const,
		paddingTop: 2,
	},
	rowText: {
		flex: 1,
		minWidth: 0,
	},
	meta: {
		flexDirection: "row" as const,
		alignItems: "center" as const,
		gap: 7,
		marginTop: 5,
	},
} satisfies Record<string, object>;
