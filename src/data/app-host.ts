import type { AppDevice } from "@neta-art/cohub";

/**
 * App runtimes talk to their host through `window.parent`. A top-level page has none, so a script
 * that runs before the App installs a MessagePort as the parent and relays it to native code.
 * Only the App's own origin gets the relay.
 */
export const APP_HOST_ORIGIN = "https://cohub.live";

const DEVICES: readonly AppDevice[] = ["camera", "microphone", "screen"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function appHostScript(appOrigin: string): string {
  return `(function(){try{
if(window.__cohubHost||window.top!==window.self||location.origin!==${JSON.stringify(appOrigin)})return;
var HOST=${JSON.stringify(APP_HOST_ORIGIN)};var host=new MessageChannel().port1;
host.postMessage=function(message){try{window.ReactNativeWebView.postMessage(JSON.stringify({cohubHost:1,message:message}))}catch(e){}};
try{Object.defineProperty(window,"parent",{configurable:true,get:function(){return host}})}catch(e){try{window.parent=host}catch(e2){}}
if(window.parent!==host)return;
try{Object.defineProperty(document,"referrer",{configurable:true,get:function(){return HOST+"/"}})}catch(e){}
var granted=[];var media=navigator.mediaDevices;
if(media&&media.getUserMedia){var original=media.getUserMedia.bind(media);media.getUserMedia=function(constraints){var wanted=[];if(constraints&&constraints.video)wanted.push("camera");if(constraints&&constraints.audio)wanted.push("microphone");for(var i=0;i<wanted.length;i++){if(granted.indexOf(wanted[i])<0)return Promise.reject(new DOMException("Cohub has not allowed this App to use the "+wanted[i]+".","NotAllowedError"))}return original(constraints)}}
window.__cohubHost={deliver:function(message){window.dispatchEvent(new MessageEvent("message",{data:message,origin:HOST,source:host}))},grant:function(devices){granted=devices.slice()}};
}catch(e){}})();true;`;
}

export function appHostDelivery(payload: Record<string, unknown>): string {
  return `window.__cohubHost&&window.__cohubHost.deliver(${JSON.stringify(payload).replace(/</g, "\\u003c")});true;`;
}

export function appHostGrant(devices: readonly AppDevice[]): string {
  return `window.__cohubHost&&window.__cohubHost.grant(${JSON.stringify(devices)});true;`;
}

export function readAppHostMessage(data: string, url: string, appOrigin: string): Record<string, unknown> | null {
  try {
    if (new URL(url).origin !== appOrigin) return null;
    const envelope = JSON.parse(data) as { cohubHost?: unknown; message?: unknown };
    if (envelope.cohubHost !== 1 || !envelope.message || typeof envelope.message !== "object" || Array.isArray(envelope.message)) return null;
    return envelope.message as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type AppRuntimeSignal = "ready" | "close";

export function appRuntimeSignal(message: Record<string, unknown>): AppRuntimeSignal | null {
  if (message.protocol !== "cohub.app.runtime" || message.version !== 1) return null;
  return message.type === "ready" ? "ready" : message.type === "close.request" ? "close" : null;
}

export function appDevicesRequest(message: Record<string, unknown>): { requestId: string; devices: AppDevice[] } | null {
  if (message.type !== "cohub.app.devices.request" || typeof message.requestId !== "string" || !message.requestId) return null;
  const raw = typeof message.devices === "string" ? message.devices.split(/[\s,]+/) : Array.isArray(message.devices) ? message.devices : [];
  const wanted = new Set(raw.map((item) => typeof item === "string" ? item.trim().toLowerCase() : item));
  const devices = DEVICES.filter((device) => wanted.has(device));
  return devices.length ? { requestId: message.requestId, devices } : null;
}

export type AppNavigationRoute =
  | { pathname: "/space/[spaceId]/file"; params: { spaceId: string; path: string } }
  | { pathname: "/chat/[sessionId]"; params: { sessionId: string; turnId?: string } }
  | { pathname: "/task/[taskId]"; params: { taskId: string } }
  | { pathname: "/space/[spaceId]/save/[checkpointId]"; params: { spaceId: string; checkpointId: string } }
  | { pathname: "/space/[spaceId]/schedule/[jobId]"; params: { spaceId: string; jobId: string } }
  | { pathname: "/work/[appId]"; params: { appId: string } };

export type AppNavigationRequest = { requestId: string; route: AppNavigationRoute | null };

const text = (value: unknown, max: number) => typeof value === "string" && value.trim() && value.length <= max ? value : null;

/** Targets are untrusted: ids must be UUIDs, paths relative; anything else is unsupported. */
export function appNavigationRequest(message: Record<string, unknown>): AppNavigationRequest | null {
  if (message.protocol !== "cohub.app.navigation" || message.version !== 1 || message.type !== "open") return null;
  const requestId = text(message.requestId, 128);
  if (!requestId) return null;
  const target = message.target as Record<string, unknown> | undefined;
  if (!target || typeof target !== "object" || message.call !== undefined) return { requestId, route: null };
  const id = (key: string) => { const value = text(target[key], 128); return value && UUID.test(value) ? value : null; };
  const spaceId = id("spaceId");
  if (target.kind === "app") {
    const ref = text(target.ref, 2048);
    return { requestId, route: ref && UUID.test(ref) ? { pathname: "/work/[appId]", params: { appId: ref } } : null };
  }
  if (!spaceId) return { requestId, route: null };
  if (target.kind === "file") {
    const path = text(target.path, 2048);
    const safe = path && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..");
    return { requestId, route: safe ? { pathname: "/space/[spaceId]/file", params: { spaceId, path } } : null };
  }
  if (target.kind === "session") {
    const sessionId = id("sessionId");
    const turnId = id("turnId");
    return { requestId, route: sessionId ? { pathname: "/chat/[sessionId]", params: { sessionId, ...(turnId ? { turnId } : {}) } } : null };
  }
  if (target.kind === "task") {
    const taskId = id("taskRunId");
    return { requestId, route: taskId ? { pathname: "/task/[taskId]", params: { taskId } } : null };
  }
  if (target.kind === "checkpoint") {
    const checkpointId = id("checkpointId");
    return { requestId, route: checkpointId ? { pathname: "/space/[spaceId]/save/[checkpointId]", params: { spaceId, checkpointId } } : null };
  }
  if (target.kind === "cronjob") {
    const jobId = id("cronjobId");
    return { requestId, route: jobId ? { pathname: "/space/[spaceId]/schedule/[jobId]", params: { spaceId, jobId } } : null };
  }
  return { requestId, route: null };
}

export function appNavigationResult(requestId: string, handled: boolean): Record<string, unknown> {
  return { protocol: "cohub.app.navigation", version: 1, type: "open.result", requestId, handled, ...(handled ? {} : { reason: "unsupported" }) };
}
