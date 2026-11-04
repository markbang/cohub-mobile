import { File } from "expo-file-system";
import { withForegroundHandoff } from "@/src/platform/app-lifecycle";

/**
 * Shows a local file in the system viewer: Quick Look on iOS, the default viewer app on Android.
 * Resolves `false` when nothing on the device can show this type.
 */
export async function previewLocalFile(uri: string, options: { title: string; mimeType: string }): Promise<boolean> {
  const file = new File(uri);
  if (!(await File.canPreview(file, { mimeType: options.mimeType }))) return false;
  // Android hands the file to another app, which reports as leaving the foreground.
  await withForegroundHandoff(() => file.preview({ title: options.title, mimeType: options.mimeType }));
  return true;
}
