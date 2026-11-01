import { File as ExpoFile, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { toUint8Array } from "js-base64";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useToast } from "@/src/components/Toast";
import { useAppActions, useAppSelector } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { Avatar, PrimaryButton, Screen, TopBar, FIELD_INPUT_CLASS, Loader } from "@/src/ui";

const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

function isForbidden(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 403;
}

export default function EditSpaceScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { client, upsertSpace } = useAppActions();
  
  const space = useAppSelector((app) => app.state.spaces.find((s) => s.id === spaceId));
  
  const [name, setName] = useState(space?.name || "");
  const [description, setDescription] = useState(space?.description || "");
  const [saving, setSaving] = useState(false);
  const [photoStage, setPhotoStage] = useState<"idle" | "picking" | "uploading">("idle");

  const spaceName = space?.name?.trim() || t("space.fallbackName");

  const changePhoto = async () => {
    if (!client || !spaceId || photoStage !== "idle") return;

    if (space?.access && !space.access.permissions.includes("space.edit")) {
      Alert.alert(t("space.edit.photoError"), t("space.edit.photoForbidden"));
      return;
    }

    setPhotoStage("picking");
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("space.edit.photoOffTitle"), t("space.edit.photoOffBody"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) {
        Alert.alert(t("space.edit.photoError"), t("space.edit.photoUnreadable"));
        return;
      }

      // ImagePicker exports base64 as JPEG on both platforms, which also normalizes PNG/WebP/GIF.
      const bytes = toUint8Array(asset.base64);
      if (bytes.byteLength > AVATAR_MAX_BYTES) {
        Alert.alert(t("space.edit.photoError"), t("space.edit.photoTooLarge"));
        return;
      }

      const file = new ExpoFile(Paths.cache, `space-avatar-${Date.now()}.jpg`);
      setPhotoStage("uploading");
      await file.write(bytes);
      try {
        const uploaded = await client.publicAssets.upload({
          purpose: "space_avatar",
          spaceId,
          file,
          mimeType: "image/jpeg",
          filename: "avatar.jpg",
        });
        const updated = await client.space(spaceId).profile({ avatarUrl: uploaded.publicUrl });
        upsertSpace(updated.space);
        toast({ title: t("space.edit.photoUpdated"), tone: "success" });
      } finally {
        try { file.delete(); } catch { /* cache cleanup is best-effort */ }
      }
    } catch (error) {
      Alert.alert(
        t("space.edit.photoError"),
        isForbidden(error)
          ? t("space.edit.photoForbidden")
          : error instanceof Error && error.message
            ? error.message
            : t("space.edit.photoFailed"),
      );
    } finally {
      setPhotoStage("idle");
    }
  };

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
      
      toast({ title: t("space.edit.saved"), tone: "success" });
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
        <View className="items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("space.edit.changePhoto")}
            accessibilityState={{ disabled: photoStage !== "idle" }}
            disabled={photoStage !== "idle"}
            onPress={() => void changePhoto()}
            className="rounded-lg active:opacity-65 disabled:opacity-65"
          >
            <Avatar name={spaceName} uri={space?.publicProfile?.avatarUrl} size={82} />
          </Pressable>
          {photoStage === "uploading" ? (
            <View className="flex-row items-center gap-2">
              <Loader />
              <Text className="text-caption text-fg-muted">{t("space.edit.uploadingPhoto")}</Text>
            </View>
          ) : (
            <Text className="text-caption text-fg-muted">{t("space.edit.changePhoto")}</Text>
          )}
        </View>

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
