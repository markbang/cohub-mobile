import { useEffect, useMemo, useState } from "react";
import { PixelRatio, Platform, Text, View, useWindowDimensions } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { isAudioFile, isVideoFile, modelFormat, videoPosterUrl, type ModelFormat } from "@/src/data/media";
import { useTranslation } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { useAppTheme } from "@/src/theme";
import { AppIcon, Loader, PrimaryButton } from "@/src/ui";

/** Pinned so a CDN release can never change what runs in the viewer. */
const THREE_VERSION = "0.180.0";
const THREE_ROOT = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
const DRACO_DECODERS = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
/** Pages load from the web app's origin, so CDN files answer the same CORS policy as on the web. */
const VIEWER_ORIGIN = "https://cohub.live";
const MODEL_TIMEOUT_MS = 45_000;

/** JSON inside an inline script: `<` is escaped so a URL cannot close the script element. */
function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function modelHtml(url: string, format: ModelFormat, background: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;overflow:hidden;background:${background};touch-action:none}canvas{display:block;width:100%;height:100%}</style>
<script type="importmap">${scriptJson({ imports: { three: `${THREE_ROOT}/build/three.module.js`, "three/addons/": `${THREE_ROOT}/examples/jsm/` } })}</script>
<script>window.__MODEL__=${scriptJson({ url, format, draco: DRACO_DECODERS })};function __post(type,detail){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:type,detail:detail}))}</script>
</head><body>
<script type="module" onerror="__post('error','The 3D viewer could not load.')">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
const { url, format, draco } = window.__MODEL__;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1));
const light = new THREE.DirectionalLight(0xffffff, 1.4);
light.position.set(3, 5, 4);
scene.add(light);
const clay = () => new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.6, metalness: 0.1 });
function fit(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  object.position.sub(box.getCenter(new THREE.Vector3()));
  const radius = Math.max(size.length() / 2, 1e-3);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(distance * 0.6, distance * 0.4, distance * 0.7);
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.maxDistance = distance * 5;
  controls.update();
}
async function load() {
  const response = await fetch(url);
  if (!response.ok) throw new Error("HTTP " + response.status);
  const buffer = await response.arrayBuffer();
  if (format === "stl") {
    const geometry = new STLLoader().parse(buffer);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, clay());
  }
  if (format === "obj") {
    const object = new OBJLoader().parse(new TextDecoder().decode(buffer));
    object.traverse((child) => { if (child.isMesh) child.material = clay(); });
    return object;
  }
  const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(draco)).setMeshoptDecoder(MeshoptDecoder);
  return (await loader.parseAsync(buffer, url.replace(/[^/?#]*([?#].*)?$/, ""))).scene;
}
load().then((object) => { scene.add(object); fit(object); __post("loaded"); }).catch((error) => __post("error", String((error && error.message) || error)));
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
</script></body></html>`;
}

function mediaHtml(kind: "video" | "audio", url: string, poster: string | null) {
  const element = kind === "video"
    ? `<video id="m" controls playsinline autoplay preload="metadata"${poster ? ` poster=${scriptJson(poster)}` : ""}></video>`
    : `<audio id="m" controls autoplay preload="metadata"></audio>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;background:black;display:flex;align-items:center;justify-content:center}video{width:100%;height:100%;object-fit:contain}audio{width:92%}</style></head>
<body>${element}<script>var m=document.getElementById("m");m.src=${scriptJson(url)};m.addEventListener("error",function(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:"error"}))});</script></body></html>`;
}

export function ModelViewer({ url, format }: { url: string; format: ModelFormat }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [state, setState] = useState<{ url: string; status: "loading" | "loaded" | "error"; message?: string }>({ url, status: "loading" });
  const status = state.url === url ? state.status : "loading";
  const html = useMemo(() => modelHtml(url, format, theme.colors.background), [format, theme.colors.background, url]);
  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => setState({ url, status: "error" }), MODEL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, url]);
  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type?: string; detail?: string };
      if (data.type === "loaded") setState({ url, status: "loaded" });
      if (data.type === "error") setState({ url, status: "error", message: data.detail });
    } catch { /* Only the viewer page posts here. */ }
  };
  return <View className="flex-1 bg-background">
    <WebView
      source={{ html, baseUrl: VIEWER_ORIGIN }}
      // design-system: WebView does not take className.
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      originWhitelist={["https://*"]}
      onShouldStartLoadWithRequest={(request) => request.url === VIEWER_ORIGIN || request.url.startsWith(`${VIEWER_ORIGIN}/`) || request.url === "about:blank"}
      onMessage={onMessage}
      javaScriptEnabled
      scrollEnabled={false}
      bounces={false}
      setSupportMultipleWindows={false}
    />
    {status === "loading" ? <View pointerEvents="none" className="absolute inset-0 items-center justify-center"><Loader size="md" /></View> : null}
    {status === "error" ? <View className="absolute inset-0 items-center justify-center gap-3 bg-background p-6">
      <AppIcon name="box" size={28} tone="muted" />
      <Text className="text-center text-subhead text-fg-muted">{t("media.modelFailed")}</Text>
      {state.message ? <Text selectable className="text-center text-caption text-fg-faint">{state.message}</Text> : null}
      <PrimaryButton variant="ghost" icon="external-link" label={t("file.openExternally")} onPress={() => void openWebLink(url).catch(() => undefined)} />
    </View> : null}
  </View>;
}

export function MediaPlayer({ url, kind, poster = null }: { url: string; kind: "video" | "audio"; poster?: string | null }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState<string | null>(null);
  const html = useMemo(() => mediaHtml(kind, url, poster), [kind, poster, url]);
  if (failed === url) return <View className="flex-1 items-center justify-center gap-3 bg-background p-6">
    <AppIcon name={kind === "video" ? "play" : "mic"} size={28} tone="muted" />
    <Text className="text-center text-subhead text-fg-muted">{t("media.playFailed")}</Text>
    <PrimaryButton variant="ghost" icon="external-link" label={t("file.openExternally")} onPress={() => void openWebLink(url).catch(() => undefined)} />
  </View>;
  return <WebView
    source={{ html, baseUrl: VIEWER_ORIGIN }}
    // design-system: the player is always on black, like the system player.
    style={{ flex: 1, backgroundColor: "#000000" }}
    originWhitelist={["https://*"]}
    onShouldStartLoadWithRequest={(request) => request.url === VIEWER_ORIGIN || request.url.startsWith(`${VIEWER_ORIGIN}/`) || request.url === "about:blank"}
    onMessage={() => setFailed(url)}
    allowsInlineMediaPlayback
    mediaPlaybackRequiresUserAction={false}
    allowsFullscreenVideo
    scrollEnabled={false}
    bounces={false}
    setSupportMultipleWindows={false}
    {...(Platform.OS === "ios" ? { allowsAirPlayForMediaPlayback: true } : {})}
  />;
}

export function UrlFilePreview({ url, path, mimeType }: { url: string; path: string; mimeType: string | null }) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const format = modelFormat(path, mimeType);
  if (format) return <ModelViewer url={url} format={format} />;
  if (isVideoFile(path, mimeType)) return <MediaPlayer url={url} kind="video" poster={videoPosterUrl(url, width, PixelRatio.get())} />;
  if (isAudioFile(path, mimeType)) return <MediaPlayer url={url} kind="audio" />;
  return <WebView
    source={{ uri: url }}
    // design-system: WebView does not take className.
    style={{ flex: 1, backgroundColor: theme.colors.background }}
    startInLoadingState
  />;
}
