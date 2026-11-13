import type { CSSProperties } from "react";
import { StyleSheet, type ImageLoadEvent, type ImageSourcePropType, type ImageStyle, type StyleProp } from "react-native";

type Props = {
  source: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain";
  onLoad?: (event: ImageLoadEvent) => void;
  onError?: () => void;
};

/**
 * React Native Web paints an Image as a background behind a hidden `<img>`, which leaves the browser nothing
 * to save, copy or open from its image menu. This draws the `<img>` itself.
 */
export function ContentImage({ source, style, resizeMode = "cover", onLoad, onError }: Props) {
  const uri = typeof source === "object" && !Array.isArray(source) ? source.uri : undefined;
  return <img
    src={uri}
    alt=""
    draggable={false}
    style={{ display: "block", ...(StyleSheet.flatten(style) as CSSProperties), objectFit: resizeMode }}
    onLoad={(event) => onLoad?.({ nativeEvent: { source: { uri: uri ?? "", width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight } } } as ImageLoadEvent)}
    onError={() => onError?.()}
  />;
}
