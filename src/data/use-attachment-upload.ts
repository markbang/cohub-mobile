import { useCallback, useSyncExternalStore } from "react";
import type { AttachmentUploadState, UploadTarget } from "@/src/data/attachment-uploads";
import { useAppActions } from "@/src/data/context";

/** The upload behind one composer chip; `null` before it starts or once a send has used it. */
export function useAttachmentUploadState(target: UploadTarget | null, uri: string): AttachmentUploadState | null {
  const { attachmentUploadState, subscribeAttachmentUploads } = useAppActions();
  const spaceId = target?.spaceId;
  const sessionId = target?.sessionId;
  const read = useCallback(
    () => spaceId ? attachmentUploadState({ spaceId, sessionId }, { uri }) : null,
    [attachmentUploadState, sessionId, spaceId, uri],
  );
  return useSyncExternalStore(subscribeAttachmentUploads, read, read);
}
