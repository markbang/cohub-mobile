import type { RefObject } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ComposerMenu } from "@/src/components/ComposerMenu";
import { useTranslation } from "@/src/i18n";
import { AppIcon, type IconName } from "@/src/ui";

export function AttachmentMenu({ anchorRef, onClose, onCamera, onPhotos, onFile }: {
  anchorRef: RefObject<View | null>;
  onClose: () => void;
  onCamera: () => void;
  onPhotos: () => void;
  onFile: () => void;
}) {
  const { t } = useTranslation();
  const actions: { icon: IconName; label: string; onPress: () => void }[] = [
    { icon: "camera", label: t("chat.attachment.camera"), onPress: onCamera },
    { icon: "images", label: t("chat.attachment.photos"), onPress: onPhotos },
    { icon: "paperclip", label: t("chat.attachment.file"), onPress: onFile },
  ];
  return <ComposerMenu anchorRef={anchorRef} title={t("chat.attachment.title")} onClose={onClose} preferredWidth={240} testID="chat-attachment-menu">
    <ScrollView className="shrink" contentContainerClassName="p-1.5" keyboardShouldPersistTaps="handled">
      {actions.map((action) => <Pressable key={action.icon} accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} className="min-h-13 flex-row items-center gap-3.5 rounded-sm px-3.5 py-3 active:bg-surface-pressed">
        <AppIcon name={action.icon} size={22} tone="secondary" />
        <Text className="text-body text-fg flex-1">{action.label}</Text>
      </Pressable>)}
    </ScrollView>
  </ComposerMenu>;
}
