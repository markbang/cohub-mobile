import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import type { AttachmentDraft } from "@/src/data/types";

function attachments(files: FileList | null | undefined): AttachmentDraft[] {
  return Array.from(files ?? [], (file, index) => ({
    uri: URL.createObjectURL(file),
    name: file.name || `pasted-file-${index + 1}`,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  }));
}

/** Files pasted or dropped onto the wrapped TextInput attach to the message; text pastes stay with the TextInput. */
export function PasteImagesInput({ onPasteImages, style, children }: { onPasteImages: (attachments: AttachmentDraft[]) => void; style?: object; children: ReactNode }) {
  const ref = useRef<View>(null);
  const onFiles = useRef(onPasteImages);
  useEffect(() => { onFiles.current = onPasteImages; });
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    const take = (event: Event, files: FileList | null | undefined) => {
      const drafts = attachments(files);
      if (drafts.length === 0) return;
      event.preventDefault();
      onFiles.current(drafts);
    };
    const paste = (event: ClipboardEvent) => take(event, event.clipboardData?.files);
    const dragOver = (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
    const drop = (event: DragEvent) => take(event, event.dataTransfer?.files);
    node.addEventListener("paste", paste);
    node.addEventListener("dragover", dragOver);
    node.addEventListener("drop", drop);
    return () => {
      node.removeEventListener("paste", paste);
      node.removeEventListener("dragover", dragOver);
      node.removeEventListener("drop", drop);
    };
  }, []);
  return <View ref={ref} style={style}>{children}</View>;
}
