import { ChatTimelineView } from "@/modules/cohub-chat-timeline";

export { ChatTimelineView };

/**
 * Both platforms draw the Chat timeline natively once the binary ships the module. Binaries v2.3.8 and
 * v2.3.9 drew iOS Chats blank; their runtime keeps the JS list, and this JS reaches only binaries with
 * the fixed module, since the fix changed the native fingerprint.
 */
export const nativeChatTimeline = ChatTimelineView !== null;
