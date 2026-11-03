import { File } from "expo-file-system";
import { TextInputWrapper } from "expo-paste-input";
import type { ReactNode } from "react";
import type { AttachmentDraft } from "@/src/data/types";

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic" };

function pastedImage(uri: string, index: number): AttachmentDraft {
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(uri)?.[1]?.toLowerCase() ?? "png";
  const file = new File(uri);
  return {
    uri,
    name: `pasted-image-${index + 1}.${extension}`,
    mimeType: IMAGE_TYPES[extension] ?? file.type ?? "image/png",
    size: file.exists ? file.size : 0,
  };
}

/**
 * Lets a wrapped TextInput take images, GIFs, and keyboard stickers from the clipboard. Text pastes
 * stay with the TextInput. `style` sizes the wrapper in place of the input it wraps.
 */
export function PasteImagesInput({ onPasteImages, style, children }: { onPasteImages: (attachments: AttachmentDraft[]) => void; style?: object; children: ReactNode }) {
  return <TextInputWrapper style={style} onPaste={(payload) => {
    if (payload.type === "images" && payload.uris.length > 0) onPasteImages(payload.uris.map(pastedImage));
  }}>{children}</TextInputWrapper>;
}
