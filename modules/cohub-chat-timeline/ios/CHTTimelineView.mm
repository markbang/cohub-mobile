#import "CHTTimelineView.h"
#import "CHTRow.h"

#include <algorithm>
#include <cmath>
#include <vector>

static const CGFloat kDefaultEstimate = 120;
static const NSTimeInterval kFlightWait = 1.2;
static const NSUInteger kPoolLimit = 6;

static NSNumber *CHTNum(id value)
{
  return [value isKindOfClass:[NSNumber class]] ? value : nil;
}

/// Buttons inside rows must not keep the timeline from scrolling once a drag starts on them.
@interface CHTScrollView : UIScrollView
@end

@implementation CHTScrollView

- (BOOL)touchesShouldCancelInContentView:(UIView *)view
{
  return YES;
}

@end

/// A row that should stay where it is on screen while rows change around it.
@interface CHTAnchor : NSObject
@property (nonatomic, copy) NSString *key;
/// The row's top in the scroll view's own coordinates (content y minus offset).
@property (nonatomic, assign) CGFloat screen;
@end

@implementation CHTAnchor

+ (instancetype)key:(NSString *)key screen:(CGFloat)screen
{
  CHTAnchor *anchor = [CHTAnchor new];
  anchor.key = key;
  anchor.screen = screen;
  return anchor;
}

@end

@interface CHTTimelineView () <UIScrollViewDelegate, CHTRowDelegate>
@end

@implementation CHTTimelineView {
  CHTScrollView *_scroll;
  UIRefreshControl *_refresh;

  NSArray<NSString *> *_keys;
  NSMutableDictionary<NSString *, NSNumber *> *_index;
  NSMutableDictionary<NSString *, NSDictionary *> *_specs;
  NSMutableDictionary<NSString *, NSNumber *> *_heights;
  NSMutableSet<NSString *> *_stale;
  NSMutableDictionary<NSString *, NSNumber *> *_typeSums;
  NSMutableDictionary<NSString *, NSNumber *> *_typeCounts;
  std::vector<CGFloat> _offsets;
  BOOL _offsetsDirty;
  CGFloat _lead;
  CGFloat _width;

  NSMutableDictionary<NSString *, CHTRowView *> *_visible;
  NSMutableDictionary<NSString *, NSMutableArray<CHTRowView *> *> *_pool;
  NSMutableDictionary<NSString *, CHTRowView *> *_sizing;
  NSMutableSet<NSString *> *_inRange;

  // Props, in points.
  CGFloat _insetTop;
  CGFloat _insetBottom;
  CGFloat _viewTop;
  CGFloat _viewBottom;
  CGFloat _followThreshold;
  CGFloat _pageThreshold;
  CGFloat _visibleFraction;
  NSTimeInterval _scrollThrottle;
  BOOL _detached;
  BOOL _keyboardEnabled;
  CGFloat _coveredInset;
  NSDictionary *_initialTarget;

  BOOL _following;
  BOOL _dragging;
  BOOL _decelerating;
  BOOL _commandScrolling;
  BOOL _loaded;
  BOOL _adjusting;
  BOOL _inPass;
  BOOL _passQueued;
  BOOL _prefetchScheduled;
  CGFloat _lift;
  CGFloat _liftPad;
  CGFloat _lastOffset;
  NSTimeInterval _lastScrollEmit;
  BOOL _nearOlder;
  BOOL _nearNewer;
  NSArray<NSString *> *_visibleKeys;
  CHTAnchor *_pendingAnchor;
  UIEdgeInsets _appliedInset;

  NSMutableDictionary<NSString *, NSDictionary *> *_flights;
  NSMutableSet<NSString *> *_flown;
  NSMutableSet<NSString *> *_pendingAppear;
  NSMutableDictionary<NSString *, UIViewPropertyAnimator *> *_runningFlights;
  NSMutableDictionary<NSString *, UIView *> *_flightViews;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _keys = @[];
    _index = [NSMutableDictionary dictionary];
    _specs = [NSMutableDictionary dictionary];
    _heights = [NSMutableDictionary dictionary];
    _stale = [NSMutableSet set];
    _typeSums = [NSMutableDictionary dictionary];
    _typeCounts = [NSMutableDictionary dictionary];
    _visible = [NSMutableDictionary dictionary];
    _pool = [NSMutableDictionary dictionary];
    _sizing = [NSMutableDictionary dictionary];
    _inRange = [NSMutableSet set];
    _flights = [NSMutableDictionary dictionary];
    _flown = [NSMutableSet set];
    _pendingAppear = [NSMutableSet set];
    _runningFlights = [NSMutableDictionary dictionary];
    _flightViews = [NSMutableDictionary dictionary];
    _offsetsDirty = YES;
    _followThreshold = 60;
    _pageThreshold = 180;
    _visibleFraction = 0.2;
    _scrollThrottle = 0.1;
    _keyboardEnabled = YES;
    _following = YES;
    _width = -1;
    _appliedInset = UIEdgeInsetsMake(-1, -1, -1, -1);

    self.clipsToBounds = NO;
    _scroll = [CHTScrollView new];
    _scroll.delegate = self;
    _scroll.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    _scroll.alwaysBounceVertical = YES;
    _scroll.showsHorizontalScrollIndicator = NO;
    _scroll.keyboardDismissMode = UIScrollViewKeyboardDismissModeNone;
    [self addSubview:_scroll];

    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:self selector:@selector(keyboardWillChange:) name:UIKeyboardWillChangeFrameNotification object:nil];
    [center addObserver:self selector:@selector(keyboardWillChange:) name:UIKeyboardWillHideNotification object:nil];
  }
  return self;
}

- (void)dealloc
{
  [NSNotificationCenter.defaultCenter removeObserver:self];
}

- (void)emit:(NSString *)name payload:(NSDictionary *)payload
{
  if (self.onEvent)
    self.onEvent(name, payload);
}

#pragma mark - Props

- (void)applyContentInset:(NSDictionary *)value
{
  _insetTop = CHTNum(value[@"top"]).doubleValue;
  _insetBottom = CHTNum(value[@"bottom"]).doubleValue;
  [self setNeedsLayout];
}

- (void)applyViewportInset:(NSDictionary *)value
{
  _viewTop = CHTNum(value[@"top"]).doubleValue;
  _viewBottom = CHTNum(value[@"bottom"]).doubleValue;
  [self setNeedsLayout];
}

- (void)applyThresholds:(NSDictionary *)value
{
  if (CHTNum(value[@"follow"]))
    _followThreshold = CHTNum(value[@"follow"]).doubleValue;
  if (CHTNum(value[@"page"]))
    _pageThreshold = CHTNum(value[@"page"]).doubleValue;
  if (CHTNum(value[@"visibleFraction"]))
    _visibleFraction = CHTNum(value[@"visibleFraction"]).doubleValue;
  if (CHTNum(value[@"scrollEventThrottle"]))
    _scrollThrottle = CHTNum(value[@"scrollEventThrottle"]).doubleValue / 1000.0;
}

- (void)applyDetached:(BOOL)detached
{
  _detached = detached;
  if (detached)
    [self setFollowing:NO];
}

- (void)applyKeyboard:(NSDictionary *)value
{
  _keyboardEnabled = CHTNum(value[@"enabled"]) ? CHTNum(value[@"enabled"]).boolValue : YES;
  _coveredInset = CHTNum(value[@"coveredInset"]).doubleValue;
}

- (void)applyInitialTarget:(NSDictionary *)value
{
  if (!_loaded)
    _initialTarget = value;
}

- (void)applyRefreshEnabled:(BOOL)enabled
{
  if (enabled && !_refresh) {
    _refresh = [UIRefreshControl new];
    [_refresh addTarget:self action:@selector(refreshPulled) forControlEvents:UIControlEventValueChanged];
  }
  _scroll.refreshControl = enabled ? _refresh : nil;
}

- (void)applyRefreshing:(BOOL)refreshing
{
  if (!_refresh)
    return;
  if (refreshing && !_refresh.isRefreshing)
    [_refresh beginRefreshing];
  else if (!refreshing && _refresh.isRefreshing)
    [_refresh endRefreshing];
}

- (void)refreshPulled
{
  [self emit:@"onRefresh" payload:@{}];
}

#pragma mark - Commands

- (void)setRowKeys:(NSArray<NSString *> *)keys rows:(NSDictionary *)rows
{
  // Rows added or removed above the reader must not move what they are reading. While
  // following, the tail pin decides instead.
  CHTAnchor *anchor = _loaded && !_following && ![keys isEqualToArray:_keys] ? [self captureAnchor] : nil;
  NSSet<NSString *> *previous = [NSSet setWithArray:_keys];
  NSString *previousFirst = _keys.firstObject;
  NSTimeInterval now = CACurrentMediaTime();
  for (NSString *key in rows) {
    NSDictionary *spec = rows[key];
    if (![spec isKindOfClass:[NSDictionary class]])
      continue;
    if (![previous containsObject:key] && [spec[@"appear"] isKindOfClass:[NSArray class]] && [spec[@"appear"] count] > 0)
      [_pendingAppear addObject:key];
    NSDictionary *flight = spec[@"flight"];
    if ([flight isKindOfClass:[NSDictionary class]] && ![_flown containsObject:key]) {
      [_flown addObject:key];
      _flights[key] = @{@"flight" : flight, @"expires" : @(now + kFlightWait)};
    }
    if (_specs[key])
      [_stale addObject:key];
    _specs[key] = spec;
  }
  _keys = [keys copy];
  [_index removeAllObjects];
  [_keys enumerateObjectsUsingBlock:^(NSString *key, NSUInteger index, BOOL *stop) {
    self->_index[key] = @(index);
  }];
  for (NSString *key in [_specs allKeys]) {
    if (!_index[key]) {
      [_specs removeObjectForKey:key];
      [_heights removeObjectForKey:key];
      [_stale removeObject:key];
      [_flights removeObjectForKey:key];
    }
  }
  [_pendingAppear intersectSet:[NSSet setWithArray:_keys]];
  [_flown intersectSet:[NSSet setWithArray:_keys]];
  _offsetsDirty = YES;
  if (keys.count != previous.count || !(previousFirst == keys.firstObject || [previousFirst isEqualToString:keys.firstObject])) {
    _nearOlder = NO;
    _nearNewer = NO;
  }
  if (!_loaded)
    [self placeInitially];
  [self pass:anchor];
}

- (void)placeInitially
{
  NSString *key = [_initialTarget[@"key"] isKindOfClass:[NSString class]] ? _initialTarget[@"key"] : nil;
  if (key && _index[key]) {
    [self setFollowing:NO];
    CGFloat position = CHTNum(_initialTarget[@"viewPosition"]).doubleValue;
    CGFloat offset = CHTNum(_initialTarget[@"viewOffset"]).doubleValue;
    _pendingAnchor = [CHTAnchor key:key screen:[self screenForPosition:position offset:offset]];
  } else {
    [self setFollowing:!_detached];
  }
}

- (void)scrollToEndAnimated:(BOOL)animated
{
  _pendingAnchor = nil;
  if (!_detached)
    [self setFollowing:YES];
  if (!_loaded)
    return;
  if (animated) {
    [self recomputeOffsets];
    [self applyGeometry];
    CGFloat target = [self maxOffset];
    if (fabs(target - _scroll.contentOffset.y) > 1) {
      _commandScrolling = YES;
      [_scroll setContentOffset:CGPointMake(0, target) animated:YES];
      return;
    }
  }
  [self stopMomentum];
  [self pass:nil];
}

- (BOOL)scrollToRowKey:(NSString *)key animated:(BOOL)animated viewPosition:(CGFloat)viewPosition viewOffset:(CGFloat)viewOffset
{
  NSNumber *index = _index[key];
  if (!index)
    return NO;
  [self setFollowing:NO];
  CHTAnchor *anchor = [CHTAnchor key:key screen:[self screenForPosition:viewPosition offset:viewOffset]];
  if (!_loaded || _scroll.bounds.size.height <= 0) {
    _pendingAnchor = anchor;
    return YES;
  }
  // A row already measured nearby glides to its place; a distant one is placed directly, since
  // a seek across rows nobody has measured cannot know where to stop.
  if (animated && _heights[key]) {
    [self recomputeOffsets];
    CGFloat target = std::clamp([self rowY:index.unsignedIntegerValue] - anchor.screen, [self minOffset], [self maxOffset]);
    if (fabs(target - _scroll.contentOffset.y) < _scroll.bounds.size.height * 2) {
      _commandScrolling = YES;
      [_scroll setContentOffset:CGPointMake(0, target) animated:YES];
      return YES;
    }
  }
  [self stopMomentum];
  [self pass:anchor];
  return YES;
}

- (void)scrollByDelta:(CGFloat)delta animated:(BOOL)animated
{
  CGPoint offset = _scroll.contentOffset;
  [_scroll setContentOffset:CGPointMake(offset.x, offset.y + delta) animated:animated];
}

- (void)setFollowingFromJS:(BOOL)following
{
  [self setFollowing:following && !_detached];
  if (_following)
    [self pass:nil];
}

- (NSDictionary *)currentState
{
  return @{
    @"following" : @(_following),
    @"dragging" : @(_dragging),
    @"momentum" : @(_decelerating),
    @"distanceToLatest" : @(MAX(0, [self maxOffset] - _scroll.contentOffset.y)),
    @"distanceToOldest" : @(MAX(0, _scroll.contentOffset.y - [self minOffset])),
    @"visibleKeys" : _visibleKeys ?: @[],
    @"keyboardLift" : @(_lift),
  };
}

- (NSDictionary *)measureRowKey:(NSString *)key nodeId:(NSString *)nodeId
{
  CHTRowView *row = _visible[key];
  if (!row)
    return nil;
  UIView *view = nodeId ? [row viewForNodeId:nodeId] : row;
  if (!view || !view.window)
    return nil;
  CGRect frame = [view convertRect:view.bounds toView:self];
  return @{@"x" : @(frame.origin.x), @"y" : @(frame.origin.y), @"width" : @(frame.size.width), @"height" : @(frame.size.height)};
}

#pragma mark - Geometry

- (CGFloat)estimateForKey:(NSString *)key
{
  NSString *type = _specs[key][@"type"] ?: @"row";
  NSInteger count = _typeCounts[type].integerValue;
  return count > 0 ? _typeSums[type].doubleValue / count : kDefaultEstimate;
}

- (CGFloat)heightAt:(NSUInteger)index
{
  NSString *key = _keys[index];
  NSNumber *height = _heights[key];
  return height ? height.doubleValue : [self estimateForKey:key];
}

- (void)recomputeOffsets
{
  if (!_offsetsDirty && _offsets.size() == _keys.count + 1)
    return;
  _offsets.assign(_keys.count + 1, 0);
  for (NSUInteger index = 0; index < _keys.count; index++)
    _offsets[index + 1] = _offsets[index] + [self heightAt:index];
  _offsetsDirty = NO;
}

- (CGFloat)total
{
  return _offsets.empty() ? 0 : _offsets.back();
}

- (CGFloat)rowY:(NSUInteger)index
{
  return _lead + _offsets[index];
}

/// The first row whose bottom is below `y` (content coordinates).
- (NSUInteger)indexAtY:(CGFloat)y
{
  if (_keys.count == 0)
    return 0;
  auto begin = _offsets.begin() + 1;
  auto found = std::upper_bound(begin, _offsets.end(), y - _lead);
  return MIN((NSUInteger)(found - begin), _keys.count - 1);
}

- (CGFloat)topInset
{
  return _insetTop + _liftPad;
}

- (void)applyGeometry
{
  CGFloat height = _scroll.bounds.size.height;
  CGFloat available = height - [self topInset] - _insetBottom;
  _lead = MAX(0, available - [self total]);
  UIEdgeInsets inset = UIEdgeInsetsMake([self topInset], 0, _insetBottom, 0);
  if (!UIEdgeInsetsEqualToEdgeInsets(inset, _appliedInset)) {
    _appliedInset = inset;
    _scroll.contentInset = inset;
  }
  CGSize size = CGSizeMake(_scroll.bounds.size.width, _lead + [self total]);
  if (!CGSizeEqualToSize(size, _scroll.contentSize))
    _scroll.contentSize = size;
  _scroll.verticalScrollIndicatorInsets = UIEdgeInsetsMake(_viewTop + _liftPad, 0, _viewBottom, 0);
}

- (CGFloat)minOffset
{
  return -_scroll.adjustedContentInset.top;
}

- (CGFloat)maxOffset
{
  return MAX([self minOffset], _scroll.contentSize.height + _scroll.adjustedContentInset.bottom - _scroll.bounds.size.height);
}

/// A position in the visible band (below the header, above the composer) in scroll coordinates.
- (CGFloat)screenForPosition:(CGFloat)position offset:(CGFloat)offset
{
  CGFloat visible = _scroll.bounds.size.height - _lift - _viewTop - _viewBottom;
  return _viewTop + _lift + MAX(0, visible) * position + offset;
}

- (CGFloat)bandTop
{
  return _scroll.contentOffset.y + _viewTop + _lift;
}

- (CGFloat)bandBottom
{
  return _scroll.contentOffset.y + _scroll.bounds.size.height - _viewBottom;
}

- (CHTAnchor *)captureAnchor
{
  if (_keys.count == 0 || _scroll.bounds.size.height <= 0)
    return nil;
  [self recomputeOffsets];
  CGFloat offset = _scroll.contentOffset.y;
  for (NSUInteger index = [self indexAtY:[self bandTop]]; index < _keys.count; index++) {
    NSString *key = _keys[index];
    if ([_specs[key][@"anchor"] isEqual:@NO])
      continue;
    return [CHTAnchor key:key screen:[self rowY:index] - offset];
  }
  return nil;
}

#pragma mark - Layout

- (void)layoutSubviews
{
  [super layoutSubviews];
  CGSize size = self.bounds.size;
  CGPoint offset = _scroll.contentOffset;
  _adjusting = YES;
  // Bounds and center: the scroll view carries the keyboard lift as a transform.
  _scroll.bounds = CGRectMake(offset.x, offset.y, size.width, size.height);
  _scroll.center = CGPointMake(size.width / 2, size.height / 2);
  _adjusting = NO;
  [self pass:nil];
}

- (void)pass:(CHTAnchor *)explicitAnchor
{
  if (_inPass) {
    _passQueued = YES;
    return;
  }
  CGFloat width = _scroll.bounds.size.width;
  CGFloat height = _scroll.bounds.size.height;
  if (width <= 0 || height <= 0)
    return;
  _inPass = YES;
  _adjusting = YES;
  if (width != _width) {
    _width = width;
    [_heights removeAllObjects];
    [_typeSums removeAllObjects];
    [_typeCounts removeAllObjects];
    _offsetsDirty = YES;
  }
  BOOL user = _dragging || _decelerating;
  CHTAnchor *anchor = explicitAnchor ?: _pendingAnchor ?: [self captureAnchor];
  BOOL pin = _following && !_detached && !_commandScrolling && !user;
  for (int iteration = 0; iteration < 6; iteration++) {
    [self recomputeOffsets];
    [self applyGeometry];
    CGFloat offset = _scroll.contentOffset.y;
    CGFloat target = offset;
    NSNumber *anchorIndex = anchor ? _index[anchor.key] : nil;
    if (pin)
      target = [self maxOffset];
    else if (anchorIndex)
      target = [self rowY:anchorIndex.unsignedIntegerValue] - anchor.screen;
    if (!user)
      target = std::clamp(target, [self minOffset], [self maxOffset]);
    if (fabs(target - offset) > 0.25)
      _scroll.contentOffset = CGPointMake(0, target);
    if (![self measureRange])
      break;
  }
  [self placeRows];
  _lastOffset = _scroll.contentOffset.y;
  _adjusting = NO;
  _inPass = NO;
  _pendingAnchor = nil;

  if (!_loaded && _keys.count > 0) {
    _loaded = YES;
    _initialTarget = nil;
    [self emit:@"onTimelineLoad" payload:@{@"following" : @(_following)}];
  }
  [self startFlights];
  [self reportVisibleRows];
  [self checkEdges];
  [self schedulePrefetch];
  if (_passQueued) {
    _passQueued = NO;
    dispatch_async(dispatch_get_main_queue(), ^{
      [self pass:nil];
    });
  }
}

- (void)rangeTop:(CGFloat *)top bottom:(CGFloat *)bottom
{
  CGFloat height = _scroll.bounds.size.height;
  *top = _scroll.contentOffset.y - height * 0.5;
  *bottom = _scroll.contentOffset.y + height * 1.5;
}

- (void)recordHeight:(CGFloat)height forKey:(NSString *)key
{
  NSString *type = _specs[key][@"type"] ?: @"row";
  NSNumber *old = _heights[key];
  if (old && fabs(old.doubleValue - height) <= 0.5) {
    [_stale removeObject:key];
    return;
  }
  if (old) {
    _typeSums[type] = @(_typeSums[type].doubleValue - old.doubleValue + height);
  } else {
    _typeSums[type] = @(_typeSums[type].doubleValue + height);
    _typeCounts[type] = @(_typeCounts[type].integerValue + 1);
  }
  _heights[key] = @(height);
  [_stale removeObject:key];
  _offsetsDirty = YES;
}

/// Binds and measures the rows around the viewport; YES when a height changed.
- (BOOL)measureRange
{
  [self recomputeOffsets];
  [_inRange removeAllObjects];
  if (_keys.count == 0)
    return NO;
  CGFloat top, bottom;
  [self rangeTop:&top bottom:&bottom];
  BOOL changed = NO;
  for (NSUInteger index = [self indexAtY:top]; index < _keys.count && [self rowY:index] < bottom; index++) {
    NSString *key = _keys[index];
    CHTRowView *row = [self rowForKey:key];
    [_inRange addObject:key];
    CGFloat height = [row layoutForWidth:_width];
    NSNumber *old = _heights[key];
    if (!old || fabs(old.doubleValue - height) > 0.5)
      changed = YES;
    [self recordHeight:height forKey:key];
  }
  return changed;
}

- (CHTRowView *)rowForKey:(NSString *)key
{
  NSDictionary *spec = _specs[key];
  CHTRowView *row = _visible[key];
  if (!row) {
    NSString *type = spec[@"type"] ?: @"row";
    NSMutableArray<CHTRowView *> *pool = _pool[type];
    // A pooled row still bound to this key keeps its content.
    NSUInteger found = [pool indexOfObjectPassingTest:^BOOL(CHTRowView *candidate, NSUInteger index, BOOL *stop) {
      return [candidate.key isEqualToString:key];
    }];
    if (found != NSNotFound) {
      row = pool[found];
      [pool removeObjectAtIndex:found];
    } else if (pool.count > 0) {
      row = pool.lastObject;
      [pool removeLastObject];
    } else {
      row = [CHTRowView new];
      row.delegate = self;
    }
    if (row.superview != _scroll)
      [_scroll addSubview:row];
    _visible[key] = row;
  }
  if (row.spec != spec || ![row.key isEqualToString:key]) {
    if (row.key && ![row.key isEqualToString:key])
      [self cancelFlight:row.key];
    [row bindKey:key spec:spec];
  }
  if ([_pendingAppear containsObject:key]) {
    [_pendingAppear removeObject:key];
    NSArray *appear = spec[@"appear"];
    [appear enumerateObjectsUsingBlock:^(NSDictionary *animation, NSUInteger index, BOOL *stop) {
      if ([animation isKindOfClass:[NSDictionary class]])
        CHTAddAnimation(row.layer, animation, [NSString stringWithFormat:@"cht-appear-%lu", (unsigned long)index]);
    }];
  }
  return row;
}

- (void)placeRows
{
  [self recomputeOffsets];
  for (NSString *key in [_visible allKeys]) {
    CHTRowView *row = _visible[key];
    NSNumber *index = _index[key];
    if (!index || ![_inRange containsObject:key]) {
      [_visible removeObjectForKey:key];
      [self recycle:row];
      continue;
    }
    NSUInteger position = index.unsignedIntegerValue;
    row.frame = CGRectMake(0, [self rowY:position], _width, [self heightAt:position]);
  }
}

- (void)recycle:(CHTRowView *)row
{
  [self cancelFlight:row.key];
  [row removeFromSuperview];
  NSString *type = row.type ?: @"row";
  NSMutableArray *pool = _pool[type];
  if (!pool) {
    pool = [NSMutableArray array];
    _pool[type] = pool;
  }
  if (pool.count < kPoolLimit)
    [pool addObject:row];
}

#pragma mark - Prefetch

/// While nothing moves, measure the unmeasured rows near the viewport with an offscreen row, so a
/// later fling rarely meets a row whose estimate is wrong.
- (void)schedulePrefetch
{
  if (_prefetchScheduled || !_loaded || _dragging || _decelerating || _commandScrolling)
    return;
  _prefetchScheduled = YES;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.12 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    self->_prefetchScheduled = NO;
    [self prefetchStep];
  });
}

- (void)prefetchStep
{
  if (_dragging || _decelerating || _commandScrolling || _keys.count == 0 || _width <= 0)
    return;
  [self recomputeOffsets];
  CGFloat height = _scroll.bounds.size.height;
  CGFloat top, bottom;
  [self rangeTop:&top bottom:&bottom];
  NSMutableArray<NSString *> *pending = [NSMutableArray array];
  NSInteger first = (NSInteger)[self indexAtY:top];
  for (NSInteger index = first - 1; index >= 0 && pending.count < 2 && [self rowY:index] > top - height * 3; index--) {
    NSString *key = _keys[index];
    if (!_heights[key] || [_stale containsObject:key])
      [pending addObject:key];
  }
  for (NSUInteger index = [self indexAtY:bottom]; index < _keys.count && pending.count < 4 && [self rowY:index] < bottom + height * 3; index++) {
    NSString *key = _keys[index];
    if ((!_heights[key] || [_stale containsObject:key]) && !_visible[key])
      [pending addObject:key];
  }
  if (pending.count == 0)
    return;
  CHTAnchor *anchor = _following ? nil : [self captureAnchor];
  for (NSString *key in pending) {
    NSDictionary *spec = _specs[key];
    NSString *type = spec[@"type"] ?: @"row";
    CHTRowView *sizing = _sizing[type];
    if (!sizing) {
      sizing = [CHTRowView new];
      _sizing[type] = sizing;
    }
    [sizing bindKey:key spec:spec];
    [self recordHeight:[sizing layoutForWidth:_width] forKey:key];
  }
  [self pass:anchor];
}

#pragma mark - Reporting

- (void)reportVisibleRows
{
  CGFloat top = [self bandTop];
  CGFloat bottom = [self bandBottom];
  CGFloat viewport = bottom - top;
  if (viewport <= 0)
    return;
  NSMutableArray<NSString *> *keys = [NSMutableArray array];
  for (NSString *key in _visible) {
    NSNumber *index = _index[key];
    if (!index)
      continue;
    CGFloat y = [self rowY:index.unsignedIntegerValue];
    CGFloat height = [self heightAt:index.unsignedIntegerValue];
    if (height <= 0)
      continue;
    CGFloat visible = MIN(y + height, bottom) - MAX(y, top);
    if (visible > 0 && visible >= MIN(height * _visibleFraction, viewport))
      [keys addObject:key];
  }
  [keys sortUsingComparator:^NSComparisonResult(NSString *left, NSString *right) {
    return [self->_index[left] compare:self->_index[right]];
  }];
  if ([keys isEqualToArray:_visibleKeys ?: @[]])
    return;
  _visibleKeys = keys;
  [self emit:@"onVisibleRows" payload:@{@"keys" : keys}];
}

- (void)checkEdges
{
  CGFloat offset = _scroll.contentOffset.y;
  CGFloat older = MAX(0, offset - [self minOffset]);
  CGFloat newer = MAX(0, [self maxOffset] - offset);
  BOOL olderNear = _keys.count > 0 && older < _pageThreshold;
  BOOL newerNear = _keys.count > 0 && newer < _pageThreshold;
  if (olderNear && !_nearOlder)
    [self emit:@"onNearEdge" payload:@{@"edge" : @"older", @"distance" : @(older)}];
  if (newerNear && !_nearNewer)
    [self emit:@"onNearEdge" payload:@{@"edge" : @"newer", @"distance" : @(newer)}];
  _nearOlder = olderNear;
  _nearNewer = newerNear;
}

- (void)emitScroll:(BOOL)force
{
  NSTimeInterval now = CACurrentMediaTime();
  if (!force && now - _lastScrollEmit < _scrollThrottle)
    return;
  _lastScrollEmit = now;
  CGFloat offset = _scroll.contentOffset.y;
  [self emit:@"onTimelineScroll"
      payload:@{
        @"offsetY" : @(offset - [self minOffset]),
        @"contentHeight" : @(_scroll.contentSize.height),
        @"viewportHeight" : @(_scroll.bounds.size.height),
        @"distanceToLatest" : @(MAX(0, [self maxOffset] - offset)),
        @"distanceToOldest" : @(MAX(0, offset - [self minOffset])),
        @"dragging" : @(_dragging),
        @"momentum" : @(_decelerating),
        @"following" : @(_following),
      }];
}

- (void)setFollowing:(BOOL)following
{
  if (_following == following)
    return;
  _following = following;
  [self emit:@"onFollowingChange" payload:@{@"following" : @(following)}];
}

- (void)stopMomentum
{
  if (!_decelerating && !_commandScrolling)
    return;
  _adjusting = YES;
  [_scroll setContentOffset:_scroll.contentOffset animated:NO];
  _adjusting = NO;
  _decelerating = NO;
  _commandScrolling = NO;
}

#pragma mark - UIScrollViewDelegate

- (void)scrollViewDidScroll:(UIScrollView *)scrollView
{
  if (_adjusting)
    return;
  CGFloat offset = scrollView.contentOffset.y;
  CGFloat delta = offset - _lastOffset;
  _lastOffset = offset;
  if (_dragging || _decelerating) {
    CGFloat distance = [self maxOffset] - offset;
    BOOL near = !_detached && distance <= _followThreshold;
    if (delta < 0 && !near)
      [self setFollowing:NO];
    else if (delta > 0 && near)
      [self setFollowing:YES];
  }
  [self pass:nil];
  [self emitScroll:NO];
}

- (void)scrollViewWillBeginDragging:(UIScrollView *)scrollView
{
  _dragging = YES;
  _decelerating = NO;
  _commandScrolling = NO;
  _pendingAnchor = nil;
  [self emit:@"onScrollPhase" payload:@{@"phase" : @"dragBegin"}];
}

- (void)scrollViewDidEndDragging:(UIScrollView *)scrollView willDecelerate:(BOOL)decelerate
{
  _dragging = NO;
  [self emit:@"onScrollPhase" payload:@{@"phase" : @"dragEnd", @"momentum" : @(decelerate)}];
  if (decelerate) {
    _decelerating = YES;
    [self emit:@"onScrollPhase" payload:@{@"phase" : @"momentumBegin"}];
  } else {
    [self endUserScroll];
  }
}

- (void)scrollViewDidEndDecelerating:(UIScrollView *)scrollView
{
  _decelerating = NO;
  [self emit:@"onScrollPhase" payload:@{@"phase" : @"momentumEnd"}];
  [self endUserScroll];
}

- (void)scrollViewDidEndScrollingAnimation:(UIScrollView *)scrollView
{
  _commandScrolling = NO;
  [self pass:nil];
  [self emitScroll:YES];
}

- (BOOL)scrollViewShouldScrollToTop:(UIScrollView *)scrollView
{
  [self setFollowing:NO];
  return YES;
}

- (void)endUserScroll
{
  CGFloat distance = [self maxOffset] - _scroll.contentOffset.y;
  if (!_detached && distance <= _followThreshold)
    [self setFollowing:YES];
  [self pass:nil];
  [self emitScroll:YES];
}

#pragma mark - CHTRowDelegate

- (void)row:(CHTRowView *)row action:(NSString *)action nodeId:(NSString *)nodeId payload:(NSDictionary *)payload
{
  [self emit:@"onRowAction"
      payload:@{
        @"key" : row.key ?: (id)NSNull.null,
        @"action" : action,
        @"nodeId" : nodeId ?: (id)NSNull.null,
        @"payload" : payload ?: (id)NSNull.null,
      }];
}

- (void)rowNeedsLayout:(CHTRowView *)row
{
  [self setNeedsLayout];
}

#pragma mark - Keyboard

- (void)keyboardWillChange:(NSNotification *)note
{
  UIWindow *window = self.window;
  if (!window || !_keyboardEnabled)
    return;
  NSDictionary *info = note.userInfo;
  CGRect end = [info[UIKeyboardFrameEndUserInfoKey] CGRectValue];
  CGRect frame = [window convertRect:end fromCoordinateSpace:window.screen.coordinateSpace];
  CGFloat overlap = 0;
  // A floating or undocked keyboard does not cover the composer's edge, and the resume frame can
  // arrive with a zero origin; neither is a keyboard to lift for.
  BOOL docked = frame.origin.y > 0 && frame.size.height > 0 && CGRectGetMaxY(frame) >= CGRectGetMaxY(window.bounds) - 1;
  if (docked && ![note.name isEqualToString:UIKeyboardWillHideNotification])
    overlap = MAX(0, CGRectGetMaxY(window.bounds) - frame.origin.y);
  NSTimeInterval duration = [info[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
  UIViewAnimationCurve curve = (UIViewAnimationCurve)[info[UIKeyboardAnimationCurveUserInfoKey] integerValue];
  [self liftTo:MAX(0, overlap - _coveredInset) duration:duration curve:curve];
}

/// The list rides the keyboard with the composer. Its top is padded by the lift so the oldest row
/// stays reachable under the header; the padding grows at once and shrinks once the keyboard settles.
- (void)liftTo:(CGFloat)lift duration:(NSTimeInterval)duration curve:(UIViewAnimationCurve)curve
{
  if (fabs(lift - _lift) < 0.5)
    return;
  _lift = lift;
  if (lift > _liftPad) {
    _liftPad = lift;
    [self pass:nil];
  }
  __weak CHTTimelineView *weakSelf = self;
  [UIView animateWithDuration:duration
      delay:0
      options:((UIViewAnimationOptions)curve << 16) | UIViewAnimationOptionBeginFromCurrentState | UIViewAnimationOptionAllowUserInteraction
      animations:^{
        CHTTimelineView *strongSelf = weakSelf;
        if (strongSelf)
          strongSelf->_scroll.transform = CGAffineTransformMakeTranslation(0, -lift);
      }
      completion:^(BOOL finished) {
        CHTTimelineView *strongSelf = weakSelf;
        if (!strongSelf || fabs(strongSelf->_lift - lift) > 0.5)
          return;
        strongSelf->_liftPad = lift;
        [strongSelf pass:nil];
        [strongSelf emit:@"onKeyboardLift" payload:@{@"lift" : @(lift)}];
      }];
}

#pragma mark - Flights

- (void)startFlights
{
  if (_flights.count == 0)
    return;
  NSTimeInterval now = CACurrentMediaTime();
  for (NSString *key in [_flights allKeys]) {
    NSDictionary *entry = _flights[key];
    NSDictionary *flight = entry[@"flight"];
    NSString *nodeId = [flight[@"nodeId"] isKindOfClass:[NSString class]] ? flight[@"nodeId"] : nil;
    UIView *target = nodeId ? [_visible[key] viewForNodeId:nodeId] : nil;
    if (!target || target.bounds.size.width <= 0) {
      if (now > [entry[@"expires"] doubleValue]) {
        [_flights removeObjectForKey:key];
        [self emit:@"onFlightEnd" payload:@{@"key" : key, @"finished" : @NO}];
      }
      continue;
    }
    [_flights removeObjectForKey:key];
    [self fly:key target:target flight:flight];
  }
}

/// Moves the destination node from the composer's frame onto its own.
- (void)fly:(NSString *)key target:(UIView *)target flight:(NSDictionary *)flight
{
  target.transform = CGAffineTransformIdentity;
  CGRect frame = [target convertRect:target.bounds toView:self];
  CGFloat right = CHTNum(flight[@"x"]).doubleValue + CHTNum(flight[@"width"]).doubleValue;
  CGFloat bottom = CHTNum(flight[@"y"]).doubleValue + CHTNum(flight[@"height"]).doubleValue;
  target.transform = CGAffineTransformMakeTranslation(right - CGRectGetMaxX(frame), bottom - CGRectGetMaxY(frame));
  NSArray *easing = [flight[@"easing"] isKindOfClass:[NSArray class]] ? flight[@"easing"] : nil;
  id<UITimingCurveProvider> timing = easing.count == 4
                                         ? [[UICubicTimingParameters alloc] initWithControlPoint1:CGPointMake([easing[0] doubleValue], [easing[1] doubleValue])
                                                                                 controlPoint2:CGPointMake([easing[2] doubleValue], [easing[3] doubleValue])]
                                         : [[UICubicTimingParameters alloc] initWithAnimationCurve:UIViewAnimationCurveEaseOut];
  NSTimeInterval duration = (CHTNum(flight[@"duration"]) ?: @420).doubleValue / 1000.0;
  UIViewPropertyAnimator *animator = [[UIViewPropertyAnimator alloc] initWithDuration:duration timingParameters:timing];
  [animator addAnimations:^{
    target.transform = CGAffineTransformIdentity;
  }];
  __weak CHTTimelineView *weakSelf = self;
  [animator addCompletion:^(UIViewAnimatingPosition position) {
    CHTTimelineView *strongSelf = weakSelf;
    target.transform = CGAffineTransformIdentity;
    if (!strongSelf)
      return;
    [strongSelf->_runningFlights removeObjectForKey:key];
    [strongSelf->_flightViews removeObjectForKey:key];
    [strongSelf emit:@"onFlightEnd" payload:@{@"key" : key, @"finished" : @(position == UIViewAnimatingPositionEnd)}];
  }];
  _runningFlights[key] = animator;
  _flightViews[key] = target;
  [animator startAnimation];
}

- (void)cancelFlight:(NSString *)key
{
  if (!key)
    return;
  UIViewPropertyAnimator *animator = _runningFlights[key];
  if (!animator)
    return;
  [_runningFlights removeObjectForKey:key];
  UIView *view = _flightViews[key];
  [_flightViews removeObjectForKey:key];
  // Stopping without finishing skips the completion, so report the end here.
  [animator stopAnimation:YES];
  view.transform = CGAffineTransformIdentity;
  [self emit:@"onFlightEnd" payload:@{@"key" : key, @"finished" : @NO}];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (!self.window) {
    for (NSString *key in [_runningFlights allKeys])
      [self cancelFlight:key];
  }
}

@end
