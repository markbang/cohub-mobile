import { ChatTimelineView } from "@/modules/cohub-chat-timeline";

export { ChatTimelineView };

/** Both platforms draw the Chat timeline natively once the binary ships the module. */
export const nativeChatTimeline = ChatTimelineView !== null;
