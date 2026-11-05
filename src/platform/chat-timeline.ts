import { Platform } from "react-native";
import { ChatTimelineView } from "@/modules/cohub-chat-timeline";

export { ChatTimelineView };

/**
 * Android draws the Chat timeline natively once the binary ships the module. iOS keeps the JS list:
 * the iOS native timeline in v2.3.8 and v2.3.9 lays out its rows but paints none, so a Chat opened
 * blank. Turn it back on here once a binary with a fixed `modules/cohub-chat-timeline/ios` ships.
 */
export const nativeChatTimeline = ChatTimelineView !== null && Platform.OS !== "ios";
