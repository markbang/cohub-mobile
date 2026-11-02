#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// The Chat timeline. Native owns what has to happen inside a frame: virtualization, keeping the
/// reading position when rows change above it, pinning the tail while following, scrolling to a
/// row, lifting with the keyboard, and the send flight. JS owns what rows exist, how they look
/// (node trees), the thresholds, and the reactions to the events.
@interface CHTTimelineView : UIView

/// Every event: `onTimelineScroll`, `onScrollPhase`, `onFollowingChange`, `onVisibleRows`,
/// `onNearEdge`, `onRowAction`, `onTimelineLoad`, `onFlightEnd`, `onKeyboardLift`, `onRefresh`.
@property (nonatomic, copy, nullable) void (^onEvent)(NSString *name, NSDictionary *payload);

- (void)applyContentInset:(NSDictionary *)value NS_SWIFT_NAME(applyContentInset(_:));
- (void)applyViewportInset:(NSDictionary *)value NS_SWIFT_NAME(applyViewportInset(_:));
- (void)applyThresholds:(NSDictionary *)value NS_SWIFT_NAME(applyThresholds(_:));
- (void)applyDetached:(BOOL)detached NS_SWIFT_NAME(applyDetached(_:));
- (void)applyKeyboard:(NSDictionary *)value NS_SWIFT_NAME(applyKeyboard(_:));
- (void)applyInitialTarget:(nullable NSDictionary *)value NS_SWIFT_NAME(applyInitialTarget(_:));
- (void)applyRefreshEnabled:(BOOL)enabled NS_SWIFT_NAME(applyRefreshEnabled(_:));
- (void)applyRefreshing:(BOOL)refreshing NS_SWIFT_NAME(applyRefreshing(_:));

- (void)setRowKeys:(NSArray<NSString *> *)keys rows:(NSDictionary *)rows NS_SWIFT_NAME(setRows(keys:rows:));
- (void)scrollToEndAnimated:(BOOL)animated NS_SWIFT_NAME(scrollToEnd(animated:));
- (BOOL)scrollToRowKey:(NSString *)key animated:(BOOL)animated viewPosition:(CGFloat)viewPosition viewOffset:(CGFloat)viewOffset
    NS_SWIFT_NAME(scrollToRow(key:animated:viewPosition:viewOffset:));
- (void)scrollByDelta:(CGFloat)delta animated:(BOOL)animated NS_SWIFT_NAME(scrollBy(delta:animated:));
- (void)setFollowingFromJS:(BOOL)following NS_SWIFT_NAME(setFollowingFromJS(_:));
- (NSDictionary *)currentState NS_SWIFT_NAME(currentState());
- (nullable NSDictionary *)measureRowKey:(NSString *)key nodeId:(nullable NSString *)nodeId NS_SWIFT_NAME(measure(rowKey:nodeId:));

@end

NS_ASSUME_NONNULL_END
