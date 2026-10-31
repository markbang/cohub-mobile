import * as Haptics from "expo-haptics";

/**
 * The app's only haptics. Each fires on the same frame as its visual and never alone: `selection`
 * when a drawn control's value changes (system controls bring their own), `commit` when a send,
 * steer, or stop leaves the device, `longPress` when a drawn menu opens from a hold, and `success`
 * or `failure` for an outcome the app reports. Nothing buzzes on scroll, row taps, or navigation.
 */
const fire = (feedback: Promise<void>) => { void feedback.catch(() => undefined); };

export const haptics = {
  selection: () => fire(Haptics.selectionAsync()),
  commit: () => fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  longPress: () => fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  failure: () => fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
