English | [简体中文](APP_ARCHITECTURE_ANALYSIS.zh-CN.md)

# Cohub App Architecture Analysis and Mobile Implementation Recommendations

## Web App Architecture Overview

### 1. **How Apps Run**

Based on an analysis of the Cohub web code, Apps run in a way similar to WeChat Mini Programs:

#### Key components:

**AppSurface.svelte** - the App container component
- Supports several content kinds:
  - `web`: embedded web page (via iframe)
  - `port`: port service (via iframe)
  - `board`: native Board rendering
  - `file`: native file rendering
- Three run modes:
  - `page`: standalone page mode
  - `background`: background mode
  - `app`: app window mode

**AppPreviewController** - the App preview controller
- Manages the lifecycle of multiple Apps
- Supports opening, closing and switching Apps
- Handles communication between Apps
- Works like browser tab management

**AppBridgeHost** - the App communication bridge
- Provides the channel between an App and the host environment
- Handles permission requests (Authorization)
- Manages the App's runtime context (Invocation Context)
- Handles navigation, Commerce, Composer and related features

### 2. **App Permissions and Authorization**

**Authorization flow:**
1. The App requests permissions with `client.auth.request()`
2. The host shows an authorization dialog (AppAuthorizeDialog)
3. Once the user grants permission, the App can call the matching SDK APIs
4. Permissions are bound to a Space and support multiple scopes

**Key APIs:**
```typescript
// Request permissions
await client.auth.request({
  scopes: Permission[],
  reason?: string,
  spaceId?: string,
  alwaysAsk?: boolean
});

// Request a Space selection
await client.auth.requestSpace({
  scopes: Permission[],
  reason?: string,
  alwaysAsk?: boolean
});

// Request creation of a new Space
await client.auth.requestCreateSpace({
  scopes: Permission[],
  space: CreateSpaceInput,
  reason?: string
});
```

### 3. **App Runtime Context**

**Invocation Context:**
- `surface`: the run surface (page/background/app)
- `source`: the source (how it was invoked)
- `spaceId`: the current Space ID
- `sessionId`: the current Session ID (when inside a conversation)
- `turnId`: the current Turn ID
- `toolCallId`: the Tool Call ID (when invoked as a tool)

**Shell Context:**
- Provides information about the host environment
- URL, navigation state, and so on

### 4. **App Communication**

**PostMessage Bridge:**
- When an App runs in an iframe, it talks to the host via postMessage
- Protocol-defined message format (@cohub/protocol)
- Supports a request-response pattern
- Type-safe API calls

**Surface RPC:**
- An App can register callable methods
- The host can call App methods via `callSurface`
- Supports timeouts
- Used for Desktop Commands and similar cases

---

## Mobile Implementation Recommendations

### Option 1: WebView + Bridge (recommended)

An architecture similar to WeChat Mini Programs:

#### Architecture design:

```typescript
// App container component
<AppContainer>
  {/* Native navigation bar */}
  <AppHeader />
  
  {/* App content area */}
  {contentKind === 'web' || contentKind === 'port' ? (
    <WebView 
      source={{ uri: contentUrl }}
      onMessage={handleBridgeMessage}
      injectedJavaScript={bridgeScript}
    />
  ) : contentKind === 'board' ? (
    <NativeBoardView />
  ) : (
    <NativeFileView />
  )}
  
  {/* Permission authorization dialog */}
  <AppAuthDialog />
</AppContainer>
```

#### Key implementation:

**1. Bridge communication layer**
```typescript
// src/features/app/AppBridge.ts
export class AppBridge {
  private webview: WebView;
  private messageHandlers: Map<string, Handler>;
  
  constructor(webview: WebView, app: AppRecord) {
    this.webview = webview;
    this.setupMessageHandler();
  }
  
  // Handle messages from the App
  handleMessage(event: WebViewMessageEvent) {
    const message = JSON.parse(event.nativeEvent.data);
    
    switch (message.type) {
      case 'auth.request':
        return this.handleAuthRequest(message);
      case 'api.call':
        return this.handleApiCall(message);
      case 'navigation.open':
        return this.handleNavigation(message);
      // ... more message types
    }
  }
  
  // Send a message to the App
  postMessage(message: any) {
    this.webview.injectJavaScript(`
      window.postMessage(${JSON.stringify(message)}, '*');
    `);
  }
}
```

**2. Permission management**
```typescript
// src/features/app/AppAuthorization.ts
export function useAppAuthorization() {
  const [pendingAuth, setPendingAuth] = useState<AuthRequest | null>(null);
  
  async function requestAuthorization(request: AuthRequest) {
    setPendingAuth(request);
    
    // Show the native authorization dialog
    const granted = await showAuthDialog(request);
    
    if (granted) {
      // Save the grant record
      await saveGrant(request.appId, request.scopes);
    }
    
    setPendingAuth(null);
    return granted;
  }
  
  return { pendingAuth, requestAuthorization };
}
```

**3. App container management**
```typescript
// src/features/app/AppContainer.tsx
export function AppContainer({ appId }: { appId: string }) {
  const { client } = useApp();
  const [detail, setDetail] = useState<AppDetailResponse | null>(null);
  const [bridge, setBridge] = useState<AppBridge | null>(null);
  const webviewRef = useRef<WebView>(null);
  
  useEffect(() => {
    // Load App details
    client.apps.get(appId).then(setDetail);
  }, [appId]);
  
  useEffect(() => {
    if (!detail || !webviewRef.current) return;
    
    // Create the Bridge
    const bridge = new AppBridge(webviewRef.current, detail.app);
    setBridge(bridge);
    
    return () => bridge.dispose();
  }, [detail]);
  
  if (!detail) return <LoadingScreen />;
  
  const contentUrl = detail.content?.url;
  
  return (
    <Screen>
      <AppHeader app={detail.app} space={detail.space} />
      
      {contentUrl ? (
        <WebView
          ref={webviewRef}
          source={{ uri: contentUrl }}
          onMessage={(event) => bridge?.handleMessage(event)}
          injectedJavaScript={BRIDGE_SCRIPT}
        />
      ) : (
        <EmptyState />
      )}
      
      <AppAuthDialog bridge={bridge} />
    </Screen>
  );
}
```

**4. Bridge injection script**
```javascript
// src/features/app/bridge-script.js
const BRIDGE_SCRIPT = `
(function() {
  // Intercept the SDK's network requests
  window.__cohubBridge = {
    postMessage: function(message) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    },
    
    // The SDK calls Native APIs through this method
    request: function(method, params) {
      return new Promise((resolve, reject) => {
        const requestId = Math.random().toString(36);
        
        window.__cohubBridge.pending[requestId] = { resolve, reject };
        
        window.__cohubBridge.postMessage({
          type: 'api.call',
          requestId,
          method,
          params
        });
      });
    },
    
    pending: {}
  };
  
  // Receive responses from Native
  window.addEventListener('message', function(event) {
    const message = event.data;
    if (message.requestId && window.__cohubBridge.pending[message.requestId]) {
      const { resolve, reject } = window.__cohubBridge.pending[message.requestId];
      delete window.__cohubBridge.pending[message.requestId];
      
      if (message.error) {
        reject(new Error(message.error));
      } else {
        resolve(message.result);
      }
    }
  });
})();
`;
```

#### Suggested directory layout:

```
src/features/app/
├── AppBridge.ts              # Bridge communication core
├── AppContainer.tsx          # App container component
├── AppHeader.tsx             # App top bar
├── AppAuthDialog.tsx         # Authorization dialog
├── AppWebView.tsx            # WebView wrapper
├── AppBoardView.tsx          # Native Board rendering
├── AppFileView.tsx           # Native File rendering
├── bridge-script.js          # Injected script
├── app-authorization.ts      # Permission management
├── app-lifecycle.ts          # Lifecycle management
└── types.ts                  # Type definitions
```

---

### Option 2: Native components (long-term)

Provide native implementations for common App kinds:

1. **Board App**: render with React Native Skia
2. **File App**: native document viewer
3. **Port App**: keep the WebView approach
4. **Web App**: keep the WebView approach

---

## Key Technical Points

### 1. **Permission system**
- Store grant records in AsyncStorage
- Manage grants by the (appId, spaceId, scope) triple
- Support revoking and re-granting

### 2. **Lifecycle management**
- App open/close events
- Foreground/background switching
- Memory management (cap the number of Apps running at once)

### 3. **Security**
- WebView sandbox isolation
- Principle of least privilege
- Sensitive APIs (such as payments) require extra confirmation

### 4. **Performance**
- App preloading
- WebView pool reuse
- Lazy-load non-essential features

---

## Implementation Roadmap

### Phase 1: Core architecture (2-3 weeks)
1. ✅ App detail page and editing (done)
2. App Bridge communication layer
3. WebView container component
4. Basic permission management

### Phase 2: Feature completion (2-3 weeks)
1. Authorization dialog UI
2. Multi-window App management
3. Navigation API support
4. Commerce API support

### Phase 3: Native optimization (3-4 weeks)
1. Native Board rendering
2. Native File viewer
3. Performance optimization
4. Error handling and logging

### Phase 4: Advanced features (as needed)
1. Inter-App communication
2. Background mode
3. Desktop Commands
4. Push notification integration

---

## Summary

Cohub's App system is indeed similar to WeChat Mini Programs. At its core:

1. **Containerized execution**: Apps run inside a controlled WebView or native container
2. **Permission isolation**: a permission system controls what an App can do
3. **Bridge communication**: a standardized host-App communication protocol
4. **Lifecycle management**: a unified open, close and switch mechanism

The key to the mobile implementation is a robust Bridge layer, so Web Apps run seamlessly while leaving room for native rendering.

Start with the WebView + Bridge approach, prove it works, then add native optimizations step by step.
