import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useToast } from "@/src/components/Toast";
import { useApp } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { LoadingRows, PrimaryButton, Screen, TopBar , FIELD_INPUT_CLASS } from "@/src/ui";
import type { AppDetailResponse } from "@neta-art/cohub";

export default function EditAppScreen() {
  const { appId } = useLocalSearchParams<{ appId: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useApp();
  
  const [detail, setDetail] = useState<AppDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [published, setPublished] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!client || !appId) return;
    let active = true;
    
    void client.apps.get(appId).then((result) => {
      if (active) {
        setDetail(result);
        setTitle(result.app.meta?.title || result.app.meta?.name || "");
        setDescription(result.app.meta?.description || "");
        setPublished(result.app.status === "published");
        setLoading(false);
      }
    }).catch((caught) => {
      if (active) {
        setError(caught instanceof Error ? caught.message : t("work.error"));
        setLoading(false);
      }
    });
    
    return () => { active = false; };
  }, [appId, client, t]);

  const handleSave = async () => {
    if (!client || !appId || !detail) return;

    setSaving(true);
    try {
      await client.apps.update(appId, {
        status: published ? "published" : "disabled",
        meta: {
          ...detail.app.meta,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
        },
      });
      
      toast({ title: t("app.edit.saved") });
      router.back();
    } catch (error) {
      Alert.alert(
        t("app.edit.error"),
        error instanceof Error ? error.message : t("app.edit.saveFailed")
      );
    } finally {
      setSaving(false);
    }
  };


  if (loading) {
    return (
      <Screen>
        <TopBar title={t("app.edit.title")} onBack={() => router.back()} />
        <LoadingRows count={4} />
      </Screen>
    );
  }

  if (error || !detail) {
    return (
      <Screen>
        <TopBar title={t("app.edit.title")} onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-body text-danger text-center">
            {error || t("work.error")}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title={t("app.edit.title")} onBack={() => router.back()} />
      <ScrollView contentContainerClassName="gap-6 p-4" keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <Text className="text-caption font-semibold text-fg-muted">
            {t("app.edit.title.label")}
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t("app.edit.titlePlaceholder")}
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="words"
            autoCorrect={false}
            className={FIELD_INPUT_CLASS}
          />
        </View>

        <View className="gap-2">
          <Text className="text-caption font-semibold text-fg-muted">
            {t("app.edit.description")}
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder={t("app.edit.descriptionPlaceholder")}
            placeholderTextColor={theme.colors.textFaint}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            className={`min-h-30 ${FIELD_INPUT_CLASS}`}
          />
        </View>

        <View className="flex-row items-center gap-3 py-3 border-b border-border">
          <View className="flex-1">
            <Text className="text-body font-semibold text-fg">
              {t("app.edit.published")}
            </Text>
            <Text className="text-caption text-fg-muted mt-1">
              {t("app.edit.publishedDescription")}
            </Text>
          </View>
          <Switch
            value={published}
            onValueChange={setPublished}
            trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
            thumbColor={theme.colors.surface}
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
