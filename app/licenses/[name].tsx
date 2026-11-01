import { useLocalSearchParams } from "expo-router";
import { LicenseDetailScreen } from "@/src/components/LicensesScreen";

export default function LicenseDetailRoute() {
  const { name } = useLocalSearchParams<{ name: string }>();
  return <LicenseDetailScreen name={name} />;
}
