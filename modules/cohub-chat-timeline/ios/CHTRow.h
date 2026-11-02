#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// What a row's nodes report: presses, links, and size changes the row did not cause itself.
@protocol CHTRowDelegate <NSObject>
- (void)row:(id)row action:(NSString *)action nodeId:(nullable NSString *)nodeId payload:(nullable NSDictionary *)payload;
- (void)rowNeedsLayout:(id)row;
@end

/// One timeline row: a JS node tree laid out by Yoga at the list's width.
@interface CHTRowView : UIView

@property (nonatomic, copy, nullable) NSString *key;
@property (nonatomic, copy, nullable) NSString *type;
/// The description this row was last bound with; identity tells whether a rebind is needed.
@property (nonatomic, strong, nullable) NSDictionary *spec;
@property (nonatomic, weak, nullable) id<CHTRowDelegate> delegate;

- (void)bindKey:(NSString *)key spec:(NSDictionary *)spec;
/// Lays the tree out at `width` and returns the row height. Cheap when nothing changed.
- (CGFloat)layoutForWidth:(CGFloat)width;
/// The view of the node with `nodeId`, for flights and measurement.
- (nullable UIView *)viewForNodeId:(NSString *)nodeId;
- (void)setAnimating:(BOOL)animating;

@end

/// Runs a keyframed animation (`{property, keyframes, duration, delay, iterations, easing}`) on a layer.
FOUNDATION_EXPORT void CHTAddAnimation(CALayer *layer, NSDictionary *animation, NSString *key);
FOUNDATION_EXPORT CAMediaTimingFunction *CHTTimingFunction(id _Nullable easing);
/// A `processColor` number as a color.
FOUNDATION_EXPORT UIColor *_Nullable CHTColor(id _Nullable value);

NS_ASSUME_NONNULL_END
