import { TabStack } from "@/src/components/TabStack";
import { useTranslation } from "@/src/i18n";

export default function SpacesLayout() {
  const { t } = useTranslation();
  return <TabStack title={t("tabs.spaces")} />;
}
