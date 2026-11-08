import type { RefObject } from "react";
import type { View } from "react-native";
import { AnchoredMenuContent, type AnchoredMenuAction } from "@/src/components/AnchoredActionMenu";
import { ComposerMenu } from "@/src/components/ComposerMenu";
import { useTranslation } from "@/src/i18n";
import { MENU_WIDTH } from "@/src/ui/anchored-menu-layout";

/** The composer's attachment menu, drawn as the system menu iOS shows from the same button. */
export function AttachmentMenu({ anchorRef, onClose, onCamera, onPhotos, onFile }: {
  anchorRef: RefObject<View | null>;
  onClose: () => void;
  onCamera: () => void;
  onPhotos: () => void;
  onFile: () => void;
}) {
  const { t } = useTranslation();
  // The menu opens up from the composer, and UIKit lists an upward menu from the bottom: the first item sits
  // nearest the button.
  const actions: AnchoredMenuAction[] = [
    { icon: "paperclip", title: t("chat.attachment.file"), onPress: onFile },
    { icon: "images", title: t("chat.attachment.photos"), onPress: onPhotos },
    { icon: "camera", title: t("chat.attachment.camera"), onPress: onCamera },
  ];
  return <ComposerMenu anchorRef={anchorRef} title={t("chat.attachment.title")} onClose={onClose} preferredWidth={MENU_WIDTH} material="glass" testID="chat-attachment-menu">
    <AnchoredMenuContent sections={[{ actions }]} onClose={onClose} testID="chat-attachment-menu" />
  </ComposerMenu>;
}
