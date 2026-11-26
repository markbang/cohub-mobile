# UI 快照

英文版：[ui-snapshots.md](ui-snapshots.md)。

Android 绘制 iOS 的设计（见 `AGENTS.md` › Native UI）。iOS 使用系统组件，所以它的截图是参照。两个平台都执行截图，`compare` 把每一对并排放在一起：左边是 iOS，右边是 Android。

## 在 CI 中运行

每个平台有自己的工作流，因此可以只重试其中一个而无需等另一个。两者接受相同的输入：

```bash
gh workflow run ui-snapshots-android.yml --ref <branch> [-f screens=catalog-rows,settings] [-f themes=light] [-f motion=false] [-f target=tablet] [-f orientations=landscape] [-f perf=3]
gh workflow run ui-snapshots-ios.yml --ref <branch> [-f scope=core|full] [同样的输入]
```

iOS 运行默认使用 `scope=core`（见 [范围](#范围)）。Android 运行没有 scope 输入，始终截取完整列表。

两个运行都成功后，下载并在本地配对。`compare` 需要 ImageMagick 和 ffmpeg：

```bash
gh run download <android-run-id> -n ui-snapshots-android -D dist/ui-snapshots/android
gh run download <ios-run-id> -n ui-snapshots-ios -D dist/ui-snapshots/ios
node scripts/ui-snapshots.mjs compare --ios dist/ui-snapshots/ios --android dist/ui-snapshots/android
```

- `target` 和 `text_size` 接受逗号列表（`target=phone,tablet`、`text_size=default,accessibility-large`）。iOS 工作流分三个阶段。`prepare` 构建或恢复模拟器应用并运行 `scripts/ui-snapshots.mjs plan`，它把工作切成截图任务。这些任务并行运行，各自使用一台模拟器，`merge` 任务把它们合并。`text_size`（仅 iOS）为其单元设置模拟器的动态字体类别：`default`、`extra-large` 或 `accessibility-large`。留空（默认）时取该范围自己的字号。截图日志会记录所应用的类别，之后把模拟器恢复到 `large`（它的默认值）。Android 没有这个输入。
- `offline`（iOS，默认 `true`）跳过登录和 Logto 请求，因此运行不需要账号。离线模式覆盖每个屏幕和两个平板方向，包括分屏流程的布局检查和新建 Chat 草稿；只有发送被略去。已登录的运行（`offline=false`）从账号自己的数据渲染相同的屏幕，并在 `e2e/tablet/split-send.yaml` 中加上发送。应用只在调试包中保留这些功能（`src/auth/e2e-session.ts`）。
- iOS 参照运行在 iOS 27 上，使用 GitHub 的 `xcode-27` 镜像（预览版）。给 `ui-snapshots-ios.yml` 传 `-f ios=26`，则改用默认镜像上的 iOS 26 截图；绘制的 Android UI 仍跟随 iOS 27。
- `.github/workflows/ui-snapshots-android.yml` 和 `.github/workflows/ui-snapshots-ios.yml` 构建调试二进制并按原生指纹缓存。分支的 JS 从 Metro 提供，因此只改 JS 时复用已缓存的二进制。原生改动会重建，Android 约 30 分钟，iOS 约 60 分钟。
- 截图默认在没有账号的情况下使用种子数据运行（`offline=true`）。`offline=false` 通过登录流程（`e2e/auth/`）登录，使用 `E2E_ACCOUNT_EMAIL` 和 `E2E_ACCOUNT_PASSWORD` 密钥（开发租户的账号），而租户的 CAPTCHA 会拦住这一步。
- Android 设备端 E2E（`.github/workflows/e2e-android.yml`）为 `disabled_manually`。它依赖同一个网页登录，而 CAPTCHA 使它无法无人值守地运行，所以不要重新启用。
- `motion_themes`（iOS，默认 `light`）设置录制所用的主题，`light,dark` 表示两者都录。每个视频放在 `motion/<theme>/<interaction>.mp4`，旁边有 `motion/<theme>/<interaction>.json` 附属文件（见 [录制](#录制)）。
- 产物：`ui-snapshots-android` 和 `ui-snapshots-ios`，各自包含 `<theme>/<screen>.png` 与 `motion/<theme>/<interaction>.mp4`。非默认字号写入带后缀的目录，而不是覆盖默认结果：手机上是 `<theme>-<size>/`，平板上是 `tablet-<orientation>/<theme>-<size>/`，所以 `light/` 是默认字号，`light-accessibility-large/` 是大字号。平板运行上传的是 `ui-snapshots-android-tablet` 和 `ui-snapshots-ios-tablet`（见 [平板](#平板)）。
- iOS 分片。`ui-snapshots-ios.yml` 把每个截图任务上传为 `ui-snapshots-ios-<n>`（手机）或 `ui-snapshots-ios-tablet-<n>`（平板），`merge` 任务把它们合并为 `ui-snapshots-ios` 和 `ui-snapshots-ios-tablet`，布局如上。每个任务的 Maestro 输出和流程文件位于合并产物的 `diagnostics/<任务产物名>/` 下。如果某个任务失败，合并后的产物仍保留其他任务的结果，`MISSING.txt` 列出它未能拿到的每个截图，并且运行失败。
- 截图任务不安装依赖。`prepare` 安装 `node_modules` 和 Maestro，并以它报告的键保存（`node_modules` 按锁文件，Maestro 按 `MAESTRO_VERSION`）。每个截图任务恢复 `node_modules`，缓存未命中则失败；它把 Maestro 当作优化来恢复，恢复未命中或失败时则安装。每个任务的 Node 22 来自运行器的工具缓存，Bun 来自 `setup-bun`。
- 每次运行预热一次 Metro。`prepare` 启动 Metro，请求应用的第一个包（`scripts/ui-snapshots.mjs warm`），并以每次运行一个的键保存 Metro 的转换缓存；每个截图任务都恢复该保存，因此第一个包直接读取已完成的转换。每个任务的日志显示第一个包的行（`iOS Bundled <ms> … (<modules>)`）。
- 方向：平板流程在启动应用之前转动设备（在 `launchApp` 之前执行 `setOrientation`），因此横屏任务从不依赖另一个流程留下的状态。
- 计划：`plan` 把范围内的截图切成每个最多 9.5 分钟截图时长的任务（`SHARD_CAPTURE_SECONDS`，每屏时长取自 `scripts/ui-snapshots.mjs`）。默认字号的任务只含一个方向；大字号任务包含该目标的所有方向，因为它的屏幕很少。分屏流程和动效录制各自是一个或多个任务（`--part flow`、`--part motion`），`perf` 是一个任务。`scope=core`、浅色主题、离线、不录动效时，计划是五个任务：手机默认字号、手机编辑器的 accessibility-large、平板竖屏、平板横屏，以及两个方向上平板编辑器的 accessibility-large。`scope=full` 的计划同样是五个任务：手机 2 个、平板竖屏 1 个、平板横屏 1 个和分屏流程 1 个。GitHub 同时运行五个 macOS 任务，第六个会排队等待。只有一个屏幕的运行是一个任务。

## 范围

`scope` 决定屏幕。`core`（默认，本地用 `--scope core`）是预算：`themes=light`、离线、不录动效的运行，从派发到合并产物大约 15 分钟完成。`full`（`scope=full`）是 `SCREENS` 和 `TABLET_SCREENS` 中的每个屏幕，按要求的尺寸截取，外加平板分屏流程。按需运行；它比预算所允许的时间长。

Core 是最近出过问题的状态，列在 `scripts/ui-snapshots.mjs` 的 `CORE` 中：

| 状态 | 手机 | 平板 |
|---|---|---|
| 编辑器：空白、单行草稿、长草稿 | `chat-draft-empty`、`chat-draft`、`chat-draft-long` | `split-chat-draft-empty`、`split-chat-draft`、`split-chat-draft-long` |
| 编辑器在 `accessibility-large` | 上面三个，大字号 | `split-chat-draft-long`，大字号 |
| 未读分隔线，已读后消失 | `chat-unread`、`chat-unread-end` | |
| 已送达行 | `chat-delivered` | |
| 发送失败与重试 | `chat-states` | |
| 滚动时到达的回复 | `chat-arrival` | |
| Chats 长列表 | `chats`、`chats-scrolled` | |
| 真实 Chat（手机上包含 Markdown 表格和代码块） | `chat-conversation`、`chat-real` | `split-chat-real` |
| 平板分屏窗格：Chat 面板、Space、设置页、空的右窗格 | | `split-chat-panel`、`split-space`、`split-settings-page`、`split-empty` |

Core 在每个请求的主题中、离线、并在两个平板方向上截取上述每个状态。大字号任务只包含编辑器屏幕，因此默认运行只多两个小任务，而不是把列表翻倍。分屏流程（`e2e/tablet/split-layout.yaml` 及其变体）不在 core 中；`scope=full` 会运行它们。

要运行完整列表的 iOS 版本：`gh workflow run ui-snapshots-ios.yml --ref <branch> -f scope=full`。要以两种尺寸运行，加上 `-f text_size=default,accessibility-large`。`--screens` 仍会覆盖范围的屏幕：它在每个请求的字号下指定这些屏幕。

## 本地运行

先启动一台已开机的 Android 模拟器或 iOS 模拟器，然后运行：

```bash
node scripts/ui-snapshots.mjs capture --platform android --app <debug.apk>
node scripts/ui-snapshots.mjs capture --platform ios --app <Cohub.app|Cohub-ios-simulator.zip>
node scripts/ui-snapshots.mjs compare --ios dist/ui-snapshots/ios --android dist/ui-snapshots/android
```

`--target phone,tablet` 和 `--text-size default,accessibility-large` 接受逗号列表；每个单元都在同一个进程中运行。`--offline` 不用账号渲染调试种子数据，与工作流的 `offline` 输入相同。当 Metro 已在 8081 端口运行时使用 `--no-metro`。Android 手机截图会设置模拟器的像素密度，使两个平台都按 402 pt 宽布局。完成后它会重置密度。

`--scope core|full` 与 CI 一样选择屏幕（默认 core）。`--part screens|flow|motion|perf` 运行某个目标工作的一个切片，这正是截图任务的运行方式。`node scripts/ui-snapshots.mjs plan ...` 以 JSON 输出所选内容的任务。`node scripts/ui-snapshots.mjs merge --plan plan.json --shards <dir>` 合并下载的任务产物。

iOS 驱动的启动会单独重试：Maestro 报告未就绪（`iOS driver not ready in time`）的启动会重新运行，且不重复任何流程步骤。一次启动最多可用 `MAESTRO_DRIVER_STARTUP_TIMEOUT`（CI 中为 300 秒；实测能起来的启动耗时 35 到 285 秒），无声的启动会在一分钟后被杀掉。截图前，任务会在后台启动驱动（`node scripts/ui-snapshots.mjs driver`），与依赖安装并行，因此截图的首次启动通常会发现驱动已在运行；预热失败会被记录，截图则自行启动驱动。每次尝试都会记录驱动何时就绪或失败，而最终失败的启动会引用驱动的日志行和设备状态。

## 平板

`target=tablet`（本地为 `--target tablet`）截取分屏布局，其中标签应用位于左窗格，打开的 Chat 或页面位于右窗格（`src/components/SplitStack.tsx`）。

- 设备：iOS 使用 `IOS_DEVICES.tablet` 中的 iPad 模拟器（iPad Air 11 英寸为 820 × 1180 pt）。Android 使用 `pixel_tablet` AVD，按其自身密度（800 × 1280 dp）。手机运行保持固定的 402 宽密度。
- 方向：`orientations`（默认 `portrait,landscape`）。Android 通过 `user_rotation` 从主机转动。iOS 在每个流程开始时用 Maestro 的 `setOrientation` 转动。
- 每个方向之前，截图会把设备的逻辑尺寸与 `SIZE_BANDS` 对照：Android 从 `wm size` 和 `wm density` 测量，iOS 从 `IOS_DEVICES` 表读取。之后每个流程断言应用绘制了 `split-right-pane`，因此回退到手机布局的运行会失败，而不是产生截图。
- 输出：`<target>-<orientation>/<theme>/<screen>.png`，屏幕来自 `TABLET_SCREENS`。`compare` 把这些分组配对为 `<screen>.<target>-<orientation>.<theme>.png`。
- 交互流程：`e2e/tablet/split-layout.yaml` 在浅色主题下运行一次，除非 `screens` 限制了运行。它覆盖：打开 Chat 时清除未读标记、右窗格第一屏缺少返回按钮、旋转后草稿保留、第二个 Chat 替换第一个、Android 返回清空窗格，以及新建 Chat 面板。其后有一个变体：`split-offline.yaml`（无账号）按 testID 选择种子 Finance Ops 行并输入草稿但不发送；`split-send.yaml`（已登录）按位置选择一个 Space 并从测试账号发送真实消息。它的截图位于 `tablet-flow/`。

`perf=<runs>`（`--perf <runs>`）以强制开启帧探针（`EXPO_PUBLIC_FRAME_PROBE=1`）的方式，从全新启动、竖屏运行 `PERF_STEPS` 那么多次。然后它从应用的 `cohub-mobile.db` 读取探针记录，并写入 `perf/<target>-portrait.json`，每次运行一条，附带其时间窗口。探针只记录超过 25 ms 的 UI 帧和超过 50 ms 的 JS 卡顿，所以安静的运行没有事件。比较手机与平板运行时，应在同类运行器上进行。

## 种子数据

账号屏幕从不从真实账号截取。`src/data/fixtures/` 提供种子数据，`src/data/context.tsx` 中的 provider 从该种子开始，而不是调用 API，因此这些屏幕不会显示加载、网络或错误状态：

- `chats`、`chats-scrolled`、`split-chat-real`：22 个 Chat，分布在四个 Space 中，其中一个是固定的 Bot；三行未读；时间从 13 小时到十天不等。
- `chat-real` 和 `split-chat-real`：一个包含工具调用 Turn、长回复和短 Bot 回复的 Chat。
- `spaces`、`spaces-scrolled`：四个 Space；没有描述的三个显示其 Chat 数量。
- `activity`、`activity-scrolled`：一个余额、无有效订阅，以及一个 13 周的热力图。
- `settings`、`settings-scrolled`：个人资料卡片的名称、邮箱和头像。
- `chat-stripes`、`motion-stripes`：条纹 Chat（`src/data/fixtures/session.ts` 中的 `STRIPES_CHAT_ID`），是 Chats 列表的最后一行，标题为 "Stripe test pattern"，因此它上面的行不会移动。它的较早回复填满图片上方的空间。图片是 `assets/debug/stripes.png`，288 × 160 px，以 Markdown 图片呈现，显示为 360 × 200 pt（Chat 的图片框），因此不被裁剪。图片之后还有四条回复，使列表有空间把图片滚到返回按钮之下。`scripts/make-stripes-fixture.mjs` 生成这张 PNG：细线、粗条、彩条、棋盘格、细横线、一条竖线，以及顶部和底部边缘的红色与蓝色行。Chat 是根屏幕，标签栏在其下隐藏；它的覆盖层是返回按钮和编辑器。

种子由 `src/data/fixtures/index.ts` 中的 `usesFixtures()` 控制，其值为 `__DEV__ && uiSnapshots`。发布版本的 `__DEV__` 为 false，因此永远不会读取任何种子。如果某个屏幕需要种子未包含的数据，应把数据加入种子，而不是手动截取。

## 屏幕

屏幕列表是 `scripts/ui-snapshots.mjs` 中的 `SCREENS`，它把每个名称映射到一个深层链接和可选的点击。要截取新屏幕，在那里添加一个条目。

`EVIDENCE_SCREENS` 收录只在点名时才截的屏幕，核心集和全量集都不包含它们，因此任务数仍在 GitHub 五个并发 macOS 任务的上限内。`tab-bar-a` 和 `tab-bar-b` 在 Chats 标签页里绘制 `src/components/TabBarFixtureList.tsx`（`app/(tabs)/(chats)/tab-bar.tsx`，`?shift=a|b`）：固定 40 行，每行两条 17 pt 半粗文字，行高等于拟合可用的那一条带，不画滚动视图，所以标签栏保持展开。行从窗口底边定位：栏的内外边缘是在 iOS 27 手机 3× 下量得的（2622 px 窗口中上沿 2374 px、下沿 2558 px），可用带从上沿下 9 pt 到下沿上 20 pt，再往下会被透镜镜像。`a` 让一行正好从带的顶部开始，`b` 再上移四分之一行（半行会正好落在同一条行网格上），两张来自两次独立的冷启动。`tab-bar-ref-a` 和 `tab-bar-ref-b` 在 `app/debug/tab-bar.tsx` 上以同样的偏移画同样的行，那条路由没有标签栏，作为清晰参照。

`app/debug/ui.tsx` 是 UI 目录，展示每个共享原语。`?section=` 将其限制为一个部分，使每一部分都能放进一张截图。添加或改造共享组件时，把它加入目录。

`app/debug/chat.tsx` 在固定的会话上渲染 Chat 屏幕的标题、原生时间线和编辑器（`?fixture=conversation|tools|long|states|media|stream|bot`，其中 `bot` 是 Bot 的页面），因此无需账号数据即可比较 Chat 布局。`&native=0` 绘制不支持原生时间线的二进制所使用的 JS 列表；只有该列表会显示 `stream` 种子中正在进行的回复。`&draft=<text>` 设置编辑器，与 Chat 保存的草稿相同（`chat-draft` 屏幕）。`chat-draft-long` 设置一个在 402 pt 下约四行换行的草稿，`split-chat-draft-long` 则是 820 pt 下约六行的草稿，用于检验编辑器的两行布局。`&arrive=<n>` 在屏幕打开两秒后追加 n 条回复，模拟用户向上阅读时新回复到达；`chat-arrival` 屏幕会等它们出现（一个可访问的 `arrivals <n>` 标签）后再滚动。`chat-scrolled`、`chat-arrival`、`chat-keyboard` 和 `chat-keyboard-drag` 屏幕覆盖跳到最新和键盘。`app/debug/bot-list.tsx` 渲染 Bots 视图中固定 Bot 的行。

## 录制

截图之后，每个平台在 `motion_themes`（`--motion-themes`，默认浅色）的每个主题下录制 `MOTIONS`（`scripts/ui-snapshots.mjs`）中的交互：标签切换、推入与返回、控件、菜单、面板、确认，以及条纹 Chat。Android 在这一步重新开启动画缩放。`compare` 按主题用 ffmpeg 把每一对堆叠成一个 30 fps 的视频。要录制新交互，在 `MOTIONS` 中添加一个条目。在目录的 `sheet` 和 `confirm` 部分使用 `?open=0`，使录制从关闭状态开始。

每次录制在 mp4 旁边写入 `motion/<theme>/<interaction>.json`。附属文件包含录制在主机时钟上的开始时间（`startedAt`），取自 `maestro-debug/` 下 Maestro 的命令 JSON，以及每次滑动的开始时间。带有 `frames` 的录制还为每一帧写入一张 PNG，即 `motion/<theme>/<interaction>-<label>.png`。每一帧位于一个真实时间偏移处：所指滑动的开始时间加上 `ms`，再减去录制的开始时间。附属文件列出每一帧在视频中的时间。`scripts/ui-snapshots-frames.mjs` 完成这些工作，并用 ffmpeg 截取帧。

`motion-stripes` 是覆盖层的参照。从 Chats 列表打开后，图片位于折线以下。第一段拖动把图片顶边拉到编辑器顶边（底部覆盖层）。第二段拖动从编辑器上方一直拉到屏幕顶端，使图片顶边从标题胶囊和返回按钮下方经过。之后是返回滑动，结束 Chat。静止是 Maestro 在各个命令之间留下的间隔：没有任何步骤等待，因此每段静止就是模拟器在两次手势之间显示的画面。录制中只有两段拖动和返回滑动。

图片为 288 × 160 px，以 360 × 200 pt 显示，因此它的顶部几行位于标题栏之下，编辑器的玻璃会把它们模糊。Chat 没有标签栏：底部覆盖层是编辑器。

`motion-chats-list` 是列表的参照。它重新启动应用，在顶部打开带完整标签栏的 Chats 根页面。它先静止 2 秒：这段开场就是完整标签栏覆盖在行上方的画面。然后把列表向上拖动屏幕的 44%，使行从标签栏下方经过，标签栏收成气泡，再静止 2 秒。接着向下轻拨（屏幕的 5%），最后静止 2 秒。手机上，轻拨不会让完整标签栏回来。静止是在标题栏空白处的零位移滑动，所以不会按到任何一行，也不会出现菜单。录制中不点击任何东西，也从不打开搜索。滑动序号把静止计算在内：0 开场静止，1 向上拖动，2 静止，3 向下轻拨，4 最后静止。每个主题的文件夹里是 `list-<label>.png`（edge 和 halfway 在向上拖动中，hold 在开场静止中，settled 在结尾）；发布时为 `list-<theme>-<label>.png`。

每次录制写入 `motion/<theme>/motion-stripes.json`，其中的主机时钟起点来自 Maestro 的命令 JSON。这个时钟给出的帧时间是近似的，因为 Maestro 的滑动时间戳不是手势的第一帧。发布的帧直接从录制中截取：图片边缘到达各覆盖层边缘的时刻，以及每段静止开始的时刻。


## 限制

录制展示的是时序和形状。它们不展示手势手感或触觉反馈，而且由于 CI 模拟器没有 GPU，模糊效果的保真度不可靠。这些需要在真机上检查。
