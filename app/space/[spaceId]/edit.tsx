import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { useToast } from "@/src/components/Toast";
import { useApp } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { PrimaryButton, Screen, TopBar , FIELD_INPUT_CLASS } from "@/src/ui";

export default function EditSpaceScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { client, state } = useApp();
  
  const space = state.spaces.find((s) => s.id === spaceId);
  
  const [name, setName] = useState(space?.name || "");
  const [description, setDescription] = useState(space?.description || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!client || !spaceId) return;
    
    if (!name.trim()) {
      Alert.alert(t("space.edit.error"), t("space.edit.nameRequired"));
      return;
    }

    setSaving(true);
    try {
      const spaceClient = client.space(spaceId);
      
      // Update name if changed
      if (name !== space?.name) {
        await spaceClient.update({ name: name.trim() });
      }
      
      // Update description if changed
      if (description !== (space?.description || "")) {
        await spaceClient.profile({ description: description.trim() || null });
      }
      
      toast({ title: t("space.edit.saved") });
      router.back();
    } catch (error) {
      Alert.alert(
        t("space.edit.error"),
        error instanceof Error ? error.message : t("space.edit.saveFailed")
      );
    } finally {
      setSaving(false);
    }
  };


  return (
    <Screen>
      <TopBar title={t("space.edit.title")} onBack={() => router.back()} />
      <ScrollView contentContainerClassName="gap-6 p-4" keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <Text className="text-caption font-semibold text-fg-muted">
            {t("space.edit.name")}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t("space.edit.namePlaceholder")}
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="words"
            autoCorrect={false}
            className={FIELD_INPUT_CLASS}
          />
        </View>

        <View className="gap-2">
          <Text className="text-caption font-semibold text-fg-muted">
            {t("space.edit.description")}
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder={t("space.edit.descriptionPlaceholder")}
            placeholderTextColor={theme.colors.textFaint}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            className={`min-h-30 ${FIELD_INPUT_CLASS}`}
          />
        </View>

        <PrimaryButton
          label={t("common.save")}
          onPress={handleSave}
          loading={saving}
          disabled={saving}
          className="mt-4"
        />
      </ScrollView>
    </Screen>
  );
}
