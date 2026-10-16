import type { TranslationKey } from "../i18n/core";
import type { IconName } from "../icons";

export const settingsSections = {
  profile: { labelKey: "settings.section.profile", icon: "user" },
  chats: { labelKey: "settings.section.chats", icon: "messages" },
  notifications: { labelKey: "settings.section.notifications", icon: "bell" },
  channels: { labelKey: "settings.section.channels", icon: "messages" },
  rules: { labelKey: "settings.section.rules", icon: "file-text" },
  activity: { labelKey: "settings.section.activity", icon: "activity" },
  billing: { labelKey: "settings.section.billing", icon: "database" },
  referrals: { labelKey: "settings.section.referrals", icon: "gift" },
  browser: { labelKey: "settings.browser.title", icon: "external-link" },
} as const satisfies Record<string, { labelKey: TranslationKey; icon: IconName }>;

export type SettingsSection = keyof typeof settingsSections;

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string" && Object.hasOwn(settingsSections, value);
}

type SettingsMenuItem = { labelKey: TranslationKey; icon: IconName; href: string };

export const settingsMenu = [
  { labelKey: "settings.group.general", items: [
    { labelKey: "profile.appearance.title", icon: "palette", href: "/appearance" },
    { labelKey: "profile.language.title", icon: "globe", href: "/language" },
    { labelKey: "settings.browser.title", icon: "external-link", href: "/settings/browser" },
  ] },
  { labelKey: "settings.group.workspace", items: (["chats", "notifications", "channels", "rules"] as const).map((section) => ({
    ...settingsSections[section], href: `/settings/${section}` as const,
  })) },
  { labelKey: "settings.group.app", items: [
    { labelKey: "settings.storage.title", icon: "database", href: "/settings/storage" },
    { labelKey: "profile.about.title", icon: "info", href: "/about" },
  ] },
] as const satisfies readonly { labelKey: TranslationKey; items: readonly SettingsMenuItem[] }[];
