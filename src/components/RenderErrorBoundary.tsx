import * as Clipboard from "expo-clipboard";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useToast } from "@/src/components/Toast";
import { record as recordDebugEvent } from "@/src/data/debug-session";
import { useTranslation } from "@/src/i18n";
import { Mascot, PrimaryButton } from "@/src/ui";

export type RenderFailure = { details: string; retry: () => void };

type Props = {
  /** Names the boundary in diagnostics. */
  name: string;
  /** A change clears a failure, as when the screen moves to other content. */
  resetKeys: readonly unknown[];
  fallback: (failure: RenderFailure) => ReactNode;
  children: ReactNode;
};

type State = { error: unknown; componentStack: string | null; resetKeys: readonly unknown[] };

function failureDetails(error: unknown, componentStack: string | null) {
  let description: string;
  try {
    description = error instanceof Error ? error.stack ?? `${error.name}: ${error.message}` : String(error);
  } catch {
    description = "Unknown render error";
  }
  return componentStack ? `${description}\n\nComponent stack:${componentStack}` : description;
}

/**
 * Contains a render failure to one region, so the rest of the screen (its header, composer, and
 * navigation) stays usable. Route-level `ErrorBoundary` would replace the whole app instead.
 */
export class RenderErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null, resetKeys: this.props.resetKeys };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("Render failed") };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const changed = props.resetKeys.length !== state.resetKeys.length || props.resetKeys.some((key, index) => !Object.is(key, state.resetKeys[index]));
    return changed ? { error: null, componentStack: null, resetKeys: props.resetKeys } : null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    // The error class only: a message can quote rendered content.
    recordDebugEvent("ui.render.failed", { boundary: this.props.name, error: error instanceof Error ? error.name : typeof error });
  }

  private readonly retry = () => this.setState({ error: null, componentStack: null });

  override render() {
    if (this.state.error === null) return this.props.children;
    return this.props.fallback({ details: failureDetails(this.state.error, this.state.componentStack), retry: this.retry });
  }
}

export function RenderFailureView({ title, details, retry }: RenderFailure & { title: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const copy = () => {
    void Clipboard.setStringAsync(details).then(
      () => toast({ title: t("ui.renderFailed.copied"), tone: "success" }),
      () => toast({ title: t("chat.copyFailed.title"), tone: "danger" }),
    );
  };
  return <View className="flex-1 items-center justify-center px-6">
    <Mascot size={72} mood="worried" />
    <Text accessibilityRole="header" className="mt-4 text-center text-headline font-semibold text-fg">{title}</Text>
    <Text className="mt-2 max-w-75 text-center text-subhead text-fg-muted">{t("ui.renderFailed.body")}</Text>
    <View className="mt-4 flex-row gap-2">
      <PrimaryButton variant="secondary" icon="copy" label={t("ui.renderFailed.copy")} onPress={copy} />
      <PrimaryButton icon="refresh" label={t("common.retry")} onPress={retry} />
    </View>
  </View>;
}
