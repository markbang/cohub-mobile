#import "CHTRow.h"

#import <CoreText/CoreText.h>
#import <yoga/Yoga.h>

#include <cmath>
#include <cstdlib>
#include <vector>

#pragma mark - Values

static NSNumber *CHTNumber(id value)
{
  return [value isKindOfClass:[NSNumber class]] ? value : nil;
}

static NSString *CHTString(id value)
{
  return [value isKindOfClass:[NSString class]] ? value : nil;
}

static NSDictionary *CHTDict(id value)
{
  return [value isKindOfClass:[NSDictionary class]] ? value : nil;
}

static NSArray *CHTArray(id value)
{
  return [value isKindOfClass:[NSArray class]] ? value : nil;
}

static BOOL CHTBool(id value, BOOL fallback)
{
  NSNumber *number = CHTNumber(value);
  return number ? number.boolValue : fallback;
}

UIColor *CHTColor(id value)
{
  NSNumber *number = CHTNumber(value);
  if (!number)
    return nil;
  // `processColor` is ARGB; Android hands it over signed, iOS unsigned.
  uint32_t argb = (uint32_t)number.longLongValue;
  return [UIColor colorWithRed:((argb >> 16) & 0xFF) / 255.0
                         green:((argb >> 8) & 0xFF) / 255.0
                          blue:(argb & 0xFF) / 255.0
                         alpha:((argb >> 24) & 0xFF) / 255.0];
}

static CGFloat CHTRoundToPixel(CGFloat value)
{
  CGFloat scale = UIScreen.mainScreen.scale;
  return ceil(value * scale) / scale;
}

/// React Native's text scale for the system text size, so timeline text matches `Text`.
static CGFloat CHTFontScale(void)
{
  static NSDictionary<UIContentSizeCategory, NSNumber *> *map;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    map = @{
      UIContentSizeCategoryExtraSmall : @0.823,
      UIContentSizeCategorySmall : @0.882,
      UIContentSizeCategoryMedium : @0.941,
      UIContentSizeCategoryLarge : @1.0,
      UIContentSizeCategoryExtraLarge : @1.118,
      UIContentSizeCategoryExtraExtraLarge : @1.235,
      UIContentSizeCategoryExtraExtraExtraLarge : @1.353,
      UIContentSizeCategoryAccessibilityMedium : @1.786,
      UIContentSizeCategoryAccessibilityLarge : @2.143,
      UIContentSizeCategoryAccessibilityExtraLarge : @2.643,
      UIContentSizeCategoryAccessibilityExtraExtraLarge : @3.143,
      UIContentSizeCategoryAccessibilityExtraExtraExtraLarge : @3.571,
    };
  });
  NSNumber *scale = map[UIApplication.sharedApplication.preferredContentSizeCategory];
  return scale ? scale.doubleValue : 1.0;
}

static UIFontWeight CHTFontWeight(id value)
{
  NSInteger weight = 400;
  if ([value isKindOfClass:[NSString class]]) {
    weight = [value isEqualToString:@"bold"] ? 700 : [value integerValue] ?: 400;
  } else if ([value isKindOfClass:[NSNumber class]]) {
    weight = [value integerValue];
  }
  if (weight <= 100)
    return UIFontWeightUltraLight;
  if (weight <= 200)
    return UIFontWeightThin;
  if (weight <= 300)
    return UIFontWeightLight;
  if (weight <= 400)
    return UIFontWeightRegular;
  if (weight <= 500)
    return UIFontWeightMedium;
  if (weight <= 600)
    return UIFontWeightSemibold;
  if (weight <= 700)
    return UIFontWeightBold;
  if (weight <= 800)
    return UIFontWeightHeavy;
  return UIFontWeightBlack;
}

static UIFont *CHTFont(NSDictionary *text, id weightOverride)
{
  CGFloat size = (CHTNumber(text[@"fontSize"]) ?: @15).doubleValue * CHTFontScale();
  UIFontWeight weight = CHTFontWeight(weightOverride ?: text[@"fontWeight"]);
  NSString *family = CHTString(text[@"fontFamily"]);
  UIFont *font = nil;
  if (family.length > 0) {
    font = [UIFont fontWithName:family size:size] ?: [UIFont fontWithName:[family stringByAppendingString:@"-Regular"] size:size];
    if (!font && [family.lowercaseString containsString:@"mono"])
      font = [UIFont monospacedSystemFontOfSize:size weight:weight];
  }
  if (!font)
    font = [UIFont systemFontOfSize:size weight:weight];
  if ([CHTArray(text[@"fontVariant"]) containsObject:@"tabular-nums"]) {
    UIFontDescriptor *descriptor = [font.fontDescriptor fontDescriptorByAddingAttributes:@{
      UIFontDescriptorFeatureSettingsAttribute : @[ @{
        (__bridge NSString *)kCTFontFeatureTypeIdentifierKey : @(kNumberSpacingType),
        (__bridge NSString *)kCTFontFeatureSelectorIdentifierKey : @(kMonospacedNumbersSelector),
      } ],
    }];
    font = [UIFont fontWithDescriptor:descriptor size:size];
  }
  return font;
}

#pragma mark - Animations

CAMediaTimingFunction *CHTTimingFunction(id easing)
{
  NSArray *points = CHTArray(easing);
  if (points.count == 4) {
    return [CAMediaTimingFunction functionWithControlPoints:[points[0] floatValue]:[points[1] floatValue]:[points[2] floatValue]:[points[3] floatValue]];
  }
  return [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionLinear];
}

void CHTAddAnimation(CALayer *layer, NSDictionary *spec, NSString *key)
{
  NSString *property = CHTString(spec[@"property"]);
  NSArray *frames = CHTArray(spec[@"keyframes"]);
  if (!property || frames.count < 2)
    return;
  NSDictionary *paths = @{
    @"opacity" : @"opacity",
    @"translateX" : @"transform.translation.x",
    @"translateY" : @"transform.translation.y",
    @"scale" : @"transform.scale",
    @"rotate" : @"transform.rotation.z",
  };
  NSString *keyPath = paths[property];
  if (!keyPath)
    return;
  BOOL degrees = [property isEqualToString:@"rotate"];
  NSMutableArray *values = [NSMutableArray arrayWithCapacity:frames.count];
  NSMutableArray *times = [NSMutableArray arrayWithCapacity:frames.count];
  for (id entry in frames) {
    NSDictionary *frame = CHTDict(entry);
    double value = (CHTNumber(frame[@"value"]) ?: @0).doubleValue;
    [values addObject:@(degrees ? value * M_PI / 180.0 : value)];
    [times addObject:@((CHTNumber(frame[@"at"]) ?: @0).doubleValue)];
  }
  CAKeyframeAnimation *animation = [CAKeyframeAnimation animationWithKeyPath:keyPath];
  animation.values = values;
  animation.keyTimes = times;
  CAMediaTimingFunction *timing = CHTTimingFunction(spec[@"easing"]);
  NSMutableArray *timings = [NSMutableArray array];
  for (NSUInteger index = 1; index < frames.count; index++)
    [timings addObject:timing];
  animation.timingFunctions = timings;
  animation.duration = MAX(1.0, (CHTNumber(spec[@"duration"]) ?: @300).doubleValue) / 1000.0;
  double delay = (CHTNumber(spec[@"delay"]) ?: @0).doubleValue / 1000.0;
  if (delay > 0) {
    animation.beginTime = [layer convertTime:CACurrentMediaTime() fromLayer:nil] + delay;
    animation.fillMode = kCAFillModeBackwards;
  }
  NSInteger iterations = (CHTNumber(spec[@"iterations"]) ?: @1).integerValue;
  animation.repeatCount = iterations <= 0 ? HUGE_VALF : (float)iterations;
  animation.removedOnCompletion = YES;
  [layer addAnimation:animation forKey:key];
}

#pragma mark - SVG paths

namespace {

struct PathScanner {
  const char *text;
  size_t index;
  size_t length;

  void skip()
  {
    while (index < length && (text[index] == ' ' || text[index] == ',' || text[index] == '\n' || text[index] == '\t' || text[index] == '\r'))
      index++;
  }

  bool atNumber()
  {
    skip();
    if (index >= length)
      return false;
    char c = text[index];
    return (c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.';
  }

  bool number(double &out)
  {
    if (!atNumber())
      return false;
    char *end = nullptr;
    out = strtod(text + index, &end);
    if (end == text + index)
      return false;
    index = end - text;
    return true;
  }

  // Arc flags may be written without separators ("a1 1 0 01 1 1").
  bool flag(bool &out)
  {
    skip();
    if (index >= length || (text[index] != '0' && text[index] != '1'))
      return false;
    out = text[index] == '1';
    index++;
    return true;
  }
};

double vectorAngle(double ux, double uy, double vx, double vy)
{
  return atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

// SVG endpoint arcs, through the center parameterization (SVG 1.1, F.6.5).
void addArc(CGMutablePathRef path, double x1, double y1, double rx, double ry, double rotation, bool large, bool sweep, double x2, double y2)
{
  if (x1 == x2 && y1 == y2)
    return;
  rx = fabs(rx);
  ry = fabs(ry);
  if (rx == 0 || ry == 0) {
    CGPathAddLineToPoint(path, nullptr, x2, y2);
    return;
  }
  double phi = rotation * M_PI / 180.0;
  double cosPhi = cos(phi), sinPhi = sin(phi);
  double dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  double x1p = cosPhi * dx + sinPhi * dy;
  double y1p = -sinPhi * dx + cosPhi * dy;
  double lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= sqrt(lambda);
    ry *= sqrt(lambda);
  }
  double numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  double denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  double coefficient = denominator == 0 ? 0 : sqrt(fmax(0, numerator / denominator)) * (large == sweep ? -1 : 1);
  double cxp = coefficient * rx * y1p / ry;
  double cyp = coefficient * -ry * x1p / rx;
  double cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  double cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  double ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  double vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  double start = vectorAngle(1, 0, ux, uy);
  double delta = vectorAngle(ux, uy, vx, vy);
  if (!sweep && delta > 0)
    delta -= 2 * M_PI;
  else if (sweep && delta < 0)
    delta += 2 * M_PI;
  CGAffineTransform transform = CGAffineTransformMakeTranslation(cx, cy);
  transform = CGAffineTransformRotate(transform, phi);
  transform = CGAffineTransformScale(transform, rx, ry);
  CGPathAddRelativeArc(path, &transform, 0, 0, 1, start, delta);
}

CGPathRef createPath(NSString *data)
{
  CGMutablePathRef path = CGPathCreateMutable();
  const char *text = data.UTF8String;
  PathScanner scanner{text, 0, strlen(text)};
  char command = 0;
  double x = 0, y = 0, startX = 0, startY = 0, controlX = 0, controlY = 0;
  char previous = 0;
  while (true) {
    scanner.skip();
    if (scanner.index >= scanner.length)
      break;
    char c = text[scanner.index];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
      command = c;
      scanner.index++;
    } else if (command == 0) {
      break;
    }
    bool relative = command >= 'a';
    char upper = relative ? command - 32 : command;
    bool consumed = false;
    double a, b, c1, d, e, f;
    switch (upper) {
      case 'Z':
        CGPathCloseSubpath(path);
        x = startX;
        y = startY;
        consumed = true;
        command = 0;
        break;
      case 'M':
        if (scanner.number(a) && scanner.number(b)) {
          x = relative ? x + a : a;
          y = relative ? y + b : b;
          CGPathMoveToPoint(path, nullptr, x, y);
          startX = x;
          startY = y;
          // Further pairs after a move are lines.
          command = relative ? 'l' : 'L';
          consumed = true;
        }
        break;
      case 'L':
        if (scanner.number(a) && scanner.number(b)) {
          x = relative ? x + a : a;
          y = relative ? y + b : b;
          CGPathAddLineToPoint(path, nullptr, x, y);
          consumed = true;
        }
        break;
      case 'H':
        if (scanner.number(a)) {
          x = relative ? x + a : a;
          CGPathAddLineToPoint(path, nullptr, x, y);
          consumed = true;
        }
        break;
      case 'V':
        if (scanner.number(a)) {
          y = relative ? y + a : a;
          CGPathAddLineToPoint(path, nullptr, x, y);
          consumed = true;
        }
        break;
      case 'C':
        if (scanner.number(a) && scanner.number(b) && scanner.number(c1) && scanner.number(d) && scanner.number(e) && scanner.number(f)) {
          double ox = relative ? x : 0, oy = relative ? y : 0;
          CGPathAddCurveToPoint(path, nullptr, ox + a, oy + b, ox + c1, oy + d, ox + e, oy + f);
          controlX = ox + c1;
          controlY = oy + d;
          x = ox + e;
          y = oy + f;
          consumed = true;
        }
        break;
      case 'S':
        if (scanner.number(a) && scanner.number(b) && scanner.number(c1) && scanner.number(d)) {
          double ox = relative ? x : 0, oy = relative ? y : 0;
          bool reflect = previous == 'C' || previous == 'S';
          double rx = reflect ? 2 * x - controlX : x, ry = reflect ? 2 * y - controlY : y;
          CGPathAddCurveToPoint(path, nullptr, rx, ry, ox + a, oy + b, ox + c1, oy + d);
          controlX = ox + a;
          controlY = oy + b;
          x = ox + c1;
          y = oy + d;
          consumed = true;
        }
        break;
      case 'Q':
        if (scanner.number(a) && scanner.number(b) && scanner.number(c1) && scanner.number(d)) {
          double ox = relative ? x : 0, oy = relative ? y : 0;
          CGPathAddQuadCurveToPoint(path, nullptr, ox + a, oy + b, ox + c1, oy + d);
          controlX = ox + a;
          controlY = oy + b;
          x = ox + c1;
          y = oy + d;
          consumed = true;
        }
        break;
      case 'T':
        if (scanner.number(a) && scanner.number(b)) {
          double ox = relative ? x : 0, oy = relative ? y : 0;
          bool reflect = previous == 'Q' || previous == 'T';
          controlX = reflect ? 2 * x - controlX : x;
          controlY = reflect ? 2 * y - controlY : y;
          CGPathAddQuadCurveToPoint(path, nullptr, controlX, controlY, ox + a, oy + b);
          x = ox + a;
          y = oy + b;
          consumed = true;
        }
        break;
      case 'A': {
        bool large = false, sweep = false;
        if (scanner.number(a) && scanner.number(b) && scanner.number(c1) && scanner.flag(large) && scanner.flag(sweep) && scanner.number(d) && scanner.number(e)) {
          double tx = relative ? x + d : d, ty = relative ? y + e : e;
          addArc(path, x, y, a, b, c1, large, sweep, tx, ty);
          x = tx;
          y = ty;
          consumed = true;
        }
        break;
      }
      default:
        break;
    }
    if (!consumed) {
      // Malformed data: keep what was drawn so far.
      if (upper != 'Z')
        break;
    }
    previous = upper;
  }
  return path;
}

} // namespace

static NSCache<NSString *, UIBezierPath *> *CHTPathCache(void)
{
  static NSCache *cache;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    cache = [NSCache new];
    cache.countLimit = 256;
  });
  return cache;
}

static UIBezierPath *CHTPath(NSString *data)
{
  UIBezierPath *path = [CHTPathCache() objectForKey:data];
  if (!path) {
    CGPathRef cgPath = createPath(data);
    path = [UIBezierPath bezierPathWithCGPath:cgPath];
    CGPathRelease(cgPath);
    [CHTPathCache() setObject:path forKey:data];
  }
  return path;
}

#pragma mark - Node views

/// SVG paths in a view box, or an SF Symbol when the node names one.
@interface CHTVectorView : UIView
- (void)applyNode:(NSDictionary *)raw;
@end

@implementation CHTVectorView {
  NSDictionary *_raw;
  UIImageView *_symbol;
  NSArray<NSDictionary *> *_paths;
  CGRect _viewBox;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    self.opaque = NO;
    self.backgroundColor = UIColor.clearColor;
    self.contentMode = UIViewContentModeRedraw;
    self.userInteractionEnabled = NO;
    self.isAccessibilityElement = NO;
  }
  return self;
}

- (void)applyNode:(NSDictionary *)raw
{
  if ([_raw isEqual:raw])
    return;
  _raw = raw;
  NSArray *box = CHTArray(raw[@"viewBox"]);
  _viewBox = box.count == 4 ? CGRectMake([box[0] doubleValue], [box[1] doubleValue], [box[2] doubleValue], [box[3] doubleValue]) : CGRectMake(0, 0, 24, 24);
  _paths = CHTArray(raw[@"paths"]) ?: @[];
  NSString *symbolName = CHTString(raw[@"symbol"]);
  UIImage *image = symbolName ? [UIImage systemImageNamed:symbolName] : nil;
  if (image) {
    if (!_symbol) {
      _symbol = [[UIImageView alloc] initWithFrame:self.bounds];
      _symbol.contentMode = UIViewContentModeScaleAspectFit;
      _symbol.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
      [self addSubview:_symbol];
    }
    UIImageSymbolWeight weight = [CHTString(raw[@"weight"]) isEqualToString:@"semibold"] ? UIImageSymbolWeightSemibold : UIImageSymbolWeightRegular;
    _symbol.preferredSymbolConfiguration = [UIImageSymbolConfiguration configurationWithPointSize:UIFont.systemFontSize weight:weight];
    _symbol.image = image;
    _symbol.tintColor = CHTColor(raw[@"stroke"]) ?: CHTColor(raw[@"fill"]) ?: UIColor.labelColor;
    _symbol.hidden = NO;
  } else {
    _symbol.hidden = YES;
  }
  [self setNeedsDisplay];
}

- (void)drawRect:(CGRect)rect
{
  if (!_symbol.hidden && _symbol.image)
    return;
  CGSize size = self.bounds.size;
  if (_paths.count == 0 || size.width <= 0 || size.height <= 0 || _viewBox.size.width <= 0 || _viewBox.size.height <= 0)
    return;
  CGFloat scale = MIN(size.width / _viewBox.size.width, size.height / _viewBox.size.height);
  CGFloat dx = (size.width - _viewBox.size.width * scale) / 2 - _viewBox.origin.x * scale;
  CGFloat dy = (size.height - _viewBox.size.height * scale) / 2 - _viewBox.origin.y * scale;
  CGContextRef context = UIGraphicsGetCurrentContext();
  CGContextSaveGState(context);
  CGContextTranslateCTM(context, dx, dy);
  CGContextScaleCTM(context, scale, scale);
  BOOL absolute = CHTBool(_raw[@"absoluteStrokeWidth"], NO);
  double defaultWidth = (CHTNumber(_raw[@"strokeWidth"]) ?: @2).doubleValue;
  for (NSDictionary *spec in _paths) {
    NSString *data = CHTString(spec[@"d"]);
    if (!data)
      continue;
    UIBezierPath *path = CHTPath(data);
    UIColor *fill = spec[@"fill"] ? CHTColor(spec[@"fill"]) : CHTColor(_raw[@"fill"]);
    UIColor *stroke = spec[@"stroke"] ? CHTColor(spec[@"stroke"]) : CHTColor(_raw[@"stroke"]);
    if (fill) {
      [fill setFill];
      [path fill];
    }
    if (stroke) {
      double width = (CHTNumber(spec[@"strokeWidth"]) ?: @(defaultWidth)).doubleValue;
      UIBezierPath *stroked = [path copy];
      // Path space is the view box; an absolute width is in points, so undo the box scale.
      stroked.lineWidth = absolute ? width / scale : width;
      NSString *cap = CHTString(spec[@"strokeLinecap"]) ?: CHTString(_raw[@"strokeLinecap"]);
      NSString *join = CHTString(spec[@"strokeLinejoin"]) ?: CHTString(_raw[@"strokeLinejoin"]);
      stroked.lineCapStyle = [cap isEqualToString:@"butt"] ? kCGLineCapButt : kCGLineCapRound;
      stroked.lineJoinStyle = [join isEqualToString:@"miter"] ? kCGLineJoinMiter : kCGLineJoinRound;
      [stroke setStroke];
      [stroked stroke];
    }
  }
  CGContextRestoreGState(context);
}

@end

/// Plain or multi-run text with React Native's line height; selectable text is a read-only text view.
@interface CHTTextView : UIView
@property (nonatomic, readonly) BOOL selectable;
- (instancetype)initSelectable:(BOOL)selectable;
- (void)applyNode:(NSDictionary *)raw;
- (CGSize)sizeThatFitsWidth:(CGFloat)width;
@end

@implementation CHTTextView {
  UILabel *_label;
  UITextView *_textView;
  NSInteger _lines;
}

- (instancetype)initSelectable:(BOOL)selectable
{
  if (self = [super initWithFrame:CGRectZero]) {
    _selectable = selectable;
    self.backgroundColor = UIColor.clearColor;
    if (selectable) {
      _textView = [[UITextView alloc] initWithFrame:CGRectZero];
      _textView.editable = NO;
      _textView.selectable = YES;
      _textView.scrollEnabled = NO;
      _textView.backgroundColor = UIColor.clearColor;
      _textView.textContainerInset = UIEdgeInsetsZero;
      _textView.textContainer.lineFragmentPadding = 0;
      [self addSubview:_textView];
    } else {
      _label = [[UILabel alloc] initWithFrame:CGRectZero];
      _label.backgroundColor = UIColor.clearColor;
      [self addSubview:_label];
      self.userInteractionEnabled = NO;
    }
  }
  return self;
}

- (void)applyNode:(NSDictionary *)raw
{
  NSDictionary *text = CHTDict(raw[@"text"]) ?: @{};
  UIColor *color = CHTColor(text[@"color"]) ?: UIColor.labelColor;
  UIFont *font = CHTFont(text, nil);
  NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
  NSString *align = CHTString(text[@"textAlign"]);
  paragraph.alignment = [align isEqualToString:@"center"] ? NSTextAlignmentCenter : [align isEqualToString:@"right"] ? NSTextAlignmentRight : NSTextAlignmentNatural;
  CGFloat baselineOffset = 0;
  NSNumber *lineHeight = CHTNumber(text[@"lineHeight"]);
  if (lineHeight) {
    CGFloat height = lineHeight.doubleValue * CHTFontScale();
    paragraph.minimumLineHeight = height;
    paragraph.maximumLineHeight = height;
    baselineOffset = (height - font.lineHeight) / 2;
  }
  NSMutableDictionary *base = [@{
    NSFontAttributeName : font,
    NSForegroundColorAttributeName : color,
    NSParagraphStyleAttributeName : paragraph,
    NSBaselineOffsetAttributeName : @(baselineOffset),
  } mutableCopy];
  NSNumber *letterSpacing = CHTNumber(text[@"letterSpacing"]);
  if (letterSpacing)
    base[NSKernAttributeName] = letterSpacing;

  NSMutableAttributedString *content = [NSMutableAttributedString new];
  NSArray *runs = CHTArray(raw[@"runs"]);
  if (runs) {
    for (id entry in runs) {
      NSDictionary *run = CHTDict(entry);
      if (!run)
        continue;
      NSMutableDictionary *attributes = [base mutableCopy];
      UIColor *runColor = CHTColor(run[@"color"]);
      if (runColor)
        attributes[NSForegroundColorAttributeName] = runColor;
      if (run[@"fontWeight"])
        attributes[NSFontAttributeName] = CHTFont(text, run[@"fontWeight"]);
      [content appendAttributedString:[[NSAttributedString alloc] initWithString:CHTString(run[@"text"]) ?: @"" attributes:attributes]];
    }
  } else {
    [content appendAttributedString:[[NSAttributedString alloc] initWithString:CHTString(raw[@"value"]) ?: @"" attributes:base]];
  }
  _lines = MAX(0, (CHTNumber(raw[@"numberOfLines"]) ?: @0).integerValue);
  if (_label) {
    _label.attributedText = content;
    _label.numberOfLines = _lines;
    _label.lineBreakMode = _lines > 0 ? NSLineBreakByTruncatingTail : NSLineBreakByWordWrapping;
  } else {
    _textView.attributedText = content;
    _textView.textContainer.maximumNumberOfLines = _lines;
    _textView.textContainer.lineBreakMode = _lines > 0 ? NSLineBreakByTruncatingTail : NSLineBreakByWordWrapping;
  }
  [self setNeedsLayout];
}

- (CGSize)sizeThatFitsWidth:(CGFloat)width
{
  CGSize limit = CGSizeMake(width, CGFLOAT_MAX);
  CGSize size = _label ? [_label sizeThatFits:limit] : [_textView sizeThatFits:limit];
  return CGSizeMake(MIN(CHTRoundToPixel(size.width), width), CHTRoundToPixel(size.height));
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  (_label ?: (UIView *)_textView).frame = self.bounds;
}

@end

/// A remote image cropped into a rounded box; `fallbackUri` loads when the variant fails.
@interface CHTImageView : UIImageView
- (void)applyNode:(NSDictionary *)raw;
@end

@implementation CHTImageView {
  NSString *_uri;
  NSURLSessionDataTask *_task;
}

+ (NSCache<NSString *, UIImage *> *)cache
{
  static NSCache *cache;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    cache = [NSCache new];
    cache.totalCostLimit = 48 * 1024 * 1024;
  });
  return cache;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    self.contentMode = UIViewContentModeScaleAspectFill;
    self.clipsToBounds = YES;
    self.layer.cornerCurve = kCACornerCurveContinuous;
    self.userInteractionEnabled = NO;
  }
  return self;
}

- (void)applyNode:(NSDictionary *)raw
{
  NSDictionary *style = CHTDict(raw[@"style"]) ?: @{};
  self.layer.cornerRadius = (CHTNumber(style[@"borderRadius"]) ?: @0).doubleValue;
  self.backgroundColor = CHTColor(style[@"backgroundColor"]);
  NSString *uri = CHTString(raw[@"uri"]);
  if (!uri || [uri isEqualToString:_uri])
    return;
  [self load:uri fallback:CHTString(raw[@"fallbackUri"])];
}

- (void)load:(NSString *)uri fallback:(NSString *)fallback
{
  _uri = uri;
  [_task cancel];
  _task = nil;
  UIImage *cached = [[CHTImageView cache] objectForKey:uri];
  self.image = cached;
  if (cached)
    return;
  NSURL *url = [NSURL URLWithString:uri];
  if (!url) {
    if (fallback && ![fallback isEqualToString:uri])
      [self load:fallback fallback:nil];
    return;
  }
  __weak CHTImageView *weakSelf = self;
  _task = [NSURLSession.sharedSession dataTaskWithURL:url completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    UIImage *image = data && !error ? [UIImage imageWithData:data scale:UIScreen.mainScreen.scale] : nil;
    if ([response isKindOfClass:[NSHTTPURLResponse class]] && ((NSHTTPURLResponse *)response).statusCode >= 400)
      image = nil;
    dispatch_async(dispatch_get_main_queue(), ^{
      CHTImageView *view = weakSelf;
      if (!view || ![view->_uri isEqualToString:uri])
        return;
      if (image) {
        [[CHTImageView cache] setObject:image forKey:uri cost:(NSUInteger)(image.size.width * image.size.height * image.scale * image.scale * 4)];
        view.image = image;
      } else if (fallback && ![fallback isEqualToString:uri]) {
        [view load:fallback fallback:nil];
      }
    });
  }];
  [_task resume];
}

@end

/// A flexbox container: background, border, corner radius, edge rules, and press handling.
/// Without an action it lets touches through to the pressable around it.
@interface CHTBoxView : UIControl
@property (nonatomic, copy, nullable) void (^onAction)(NSString *action, NSString *_Nullable nodeId, NSDictionary *_Nullable payload);
- (void)applyNode:(NSDictionary *)raw;
@end

@implementation CHTBoxView {
  NSString *_action;
  NSString *_longAction;
  NSString *_nodeId;
  NSDictionary *_payload;
  NSNumber *_pressedOpacity;
  UIColor *_pressedColor;
  UIColor *_baseColor;
  CGFloat _baseAlpha;
  CALayer *_leftRule;
  CALayer *_topRule;
  UILongPressGestureRecognizer *_longPress;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _baseAlpha = 1;
    self.clipsToBounds = NO;
    self.layer.cornerCurve = kCACornerCurveContinuous;
    [self addTarget:self action:@selector(handleTap) forControlEvents:UIControlEventTouchUpInside];
  }
  return self;
}

- (void)applyNode:(NSDictionary *)raw
{
  NSDictionary *style = CHTDict(raw[@"style"]) ?: @{};
  _baseColor = CHTColor(style[@"backgroundColor"]);
  self.backgroundColor = _baseColor;
  CGFloat radius = (CHTNumber(style[@"borderRadius"]) ?: @0).doubleValue;
  self.layer.cornerRadius = radius;
  CGFloat borderWidth = (CHTNumber(style[@"borderWidth"]) ?: @0).doubleValue;
  UIColor *borderColor = CHTColor(style[@"borderColor"]);
  self.layer.borderWidth = borderColor ? borderWidth : 0;
  self.layer.borderColor = borderColor.CGColor;
  _leftRule = [self rule:_leftRule width:(CHTNumber(style[@"borderLeftWidth"]) ?: @0).doubleValue color:CHTColor(style[@"borderLeftColor"]) ?: borderColor];
  _topRule = [self rule:_topRule width:(CHTNumber(style[@"borderTopWidth"]) ?: @0).doubleValue color:CHTColor(style[@"borderTopColor"]) ?: borderColor];
  self.clipsToBounds = [CHTString(style[@"overflow"]) isEqualToString:@"hidden"];
  _baseAlpha = (CHTNumber(style[@"opacity"]) ?: @1).doubleValue;
  self.alpha = _baseAlpha;
  _pressedOpacity = CHTNumber(raw[@"pressedOpacity"]);
  _pressedColor = CHTColor(raw[@"pressedBackgroundColor"]);
  _nodeId = CHTString(raw[@"id"]);
  _payload = CHTDict(raw[@"payload"]);
  _action = CHTString(raw[@"action"]);
  _longAction = CHTString(raw[@"longAction"]);
  self.enabled = !CHTBool(raw[@"disabled"], NO);
  if (_longAction && !_longPress) {
    _longPress = [[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(handleLongPress:)];
    [self addGestureRecognizer:_longPress];
  }
  _longPress.enabled = _longAction != nil;
  [self setNeedsLayout];
}

- (CALayer *)rule:(CALayer *)layer width:(CGFloat)width color:(UIColor *)color
{
  if (width <= 0 || !color) {
    [layer removeFromSuperlayer];
    return nil;
  }
  if (!layer) {
    layer = [CALayer layer];
    layer.actions = @{@"bounds" : [NSNull null], @"position" : [NSNull null]};
  }
  layer.backgroundColor = color.CGColor;
  layer.name = [@(width) stringValue];
  if (layer.superlayer != self.layer)
    [self.layer addSublayer:layer];
  return layer;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  if (_leftRule)
    _leftRule.frame = CGRectMake(0, 0, _leftRule.name.doubleValue, self.bounds.size.height);
  if (_topRule)
    _topRule.frame = CGRectMake(0, 0, self.bounds.size.width, _topRule.name.doubleValue);
}

- (BOOL)isPressable
{
  return _action != nil || _longAction != nil;
}

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  UIView *hit = [super hitTest:point withEvent:event];
  return hit == self && !self.isPressable ? nil : hit;
}

- (void)setHighlighted:(BOOL)highlighted
{
  [super setHighlighted:highlighted];
  if (!self.isPressable)
    return;
  if (_pressedOpacity)
    self.alpha = highlighted ? _pressedOpacity.doubleValue * _baseAlpha : _baseAlpha;
  if (_pressedColor)
    self.backgroundColor = highlighted ? _pressedColor : _baseColor;
}

- (void)handleTap
{
  if (_action && self.enabled && self.onAction)
    self.onAction(_action, _nodeId, _payload);
}

- (void)handleLongPress:(UILongPressGestureRecognizer *)recognizer
{
  if (recognizer.state == UIGestureRecognizerStateBegan && _longAction && self.onAction)
    self.onAction(_longAction, _nodeId, _payload);
}

@end

/// The few methods the vendored `EnrichedMarkdown` adds for hosts outside Fabric.
@protocol CHTMarkdownHost <NSObject>
- (void)cohub_applyProps:(NSDictionary *)props renderInline:(BOOL)renderInline;
- (CGSize)cohub_measureWidth:(CGFloat)width;
- (void)cohub_setFrame:(CGRect)frame;
- (void)cohub_setLinkHandler:(void (^)(NSString *))onLink
            longPressHandler:(void (^)(NSString *))onLongPress
               heightHandler:(void (^)(void))onHeightChange;
@end

static Class CHTMarkdownClass(void)
{
  static Class cls;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Class candidate = NSClassFromString(@"EnrichedMarkdown");
    if ([candidate instancesRespondToSelector:@selector(cohub_applyProps:renderInline:)])
      cls = candidate;
  });
  return cls;
}

/// What the JS `EnrichedMarkdownText` sends besides the node's own fields.
static NSDictionary *CHTMarkdownDefaults(void)
{
  return @{
    @"allowFontScaling" : @YES,
    @"allowTrailingMargin" : @NO,
    @"enableImagePress" : @NO,
    @"enableCodeBlockPress" : @NO,
    @"enableTaskListItemToggle" : @NO,
    @"enableLinkPreview" : @YES,
    @"spoilerOverlay" : @"particles",
    @"writingDirection" : @"first-strong",
    @"streamingConfig" : @{@"tableMode" : @"progressive", @"codeBlockMode" : @"progressive"},
    @"selectionMenuConfig" : @{
      @"copyAsMarkdown" : @YES,
      @"copyImageUrl" : @YES,
      @"copyLabel" : @"Copy",
      @"copyAsMarkdownLabel" : @"Copy as Markdown",
      @"copyImageUrlLabel" : @"Copy Image URL",
      @"copyImageUrlsLabel" : @"Copy {count} Image URLs",
      @"copyImageUrlPluralTemplates" : @[],
    },
    @"accessibilityLabels" : @{
      @"list" : @{@"bulletPoint" : @"Bullet point", @"nestedBulletPoint" : @"Nested bullet point", @"orderedItem" : @"List item {n}", @"nestedOrderedItem" : @"Nested list item {n}"},
      @"blockquote" : @{@"quote" : @"Blockquote", @"nestedQuote" : @"Nested blockquote"},
      @"table" : @{@"row" : @"Row {n}: {content}"},
      @"math" : @{@"equation" : @"Math: {latex}"},
      @"rotor" : @{@"headings" : @"Headings", @"links" : @"Links", @"images" : @"Images"},
    },
  };
}

#pragma mark - Holders

static YGConfigRef CHTYogaConfig(void)
{
  static YGConfigRef config;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    config = YGConfigNew();
    YGConfigSetPointScaleFactor(config, UIScreen.mainScreen.scale);
  });
  return config;
}

/// One node's view and Yoga node. A scroll node lays its content out as a separate Yoga root.
@interface CHTHolder : NSObject
@property (nonatomic, copy) NSString *type;
@property (nonatomic, copy, nullable) NSString *nodeId;
@property (nonatomic, strong) UIView *view;
@property (nonatomic, assign) YGNodeRef yoga;
@property (nonatomic, strong, nullable) NSDictionary *raw;
@property (nonatomic, strong) NSMutableArray<CHTHolder *> *children;
@property (nonatomic, strong, nullable) CHTHolder *content;
@property (nonatomic, strong, nullable) id animationSignature;
@property (nonatomic, assign) BOOL horizontal;
@end

@implementation CHTHolder

- (instancetype)init
{
  if (self = [super init]) {
    _yoga = YGNodeNewWithConfig(CHTYogaConfig());
    _children = [NSMutableArray array];
  }
  return self;
}

- (void)dealloc
{
  YGNodeFree(_yoga);
}

@end

static CGSize CHTMeasureView(CHTHolder *holder, float width, YGMeasureMode widthMode)
{
  CGFloat available = widthMode == YGMeasureModeUndefined || std::isnan(width) ? UIScreen.mainScreen.bounds.size.width : width;
  CGSize size = CGSizeZero;
  if ([holder.view isKindOfClass:[CHTTextView class]]) {
    size = [(CHTTextView *)holder.view sizeThatFitsWidth:available];
  } else if ([holder.view respondsToSelector:@selector(cohub_measureWidth:)]) {
    size = [(id<CHTMarkdownHost>)holder.view cohub_measureWidth:available];
  }
  if (widthMode == YGMeasureModeExactly)
    size.width = width;
  return size;
}

static YGSize CHTMeasureLeaf(YGNodeConstRef node, float width, YGMeasureMode widthMode, float height, YGMeasureMode heightMode)
{
  CHTHolder *holder = (__bridge CHTHolder *)YGNodeGetContext(node);
  CGSize size = CHTMeasureView(holder, width, widthMode);
  return YGSize{(float)size.width, (float)size.height};
}

static YGSize CHTMeasureScroll(YGNodeConstRef node, float width, YGMeasureMode widthMode, float height, YGMeasureMode heightMode)
{
  CHTHolder *holder = (__bridge CHTHolder *)YGNodeGetContext(node);
  YGNodeRef content = holder.content.yoga;
  BOOL undefined = widthMode == YGMeasureModeUndefined || std::isnan(width);
  YGNodeCalculateLayout(content, holder.horizontal || undefined ? YGUndefined : width, YGUndefined, YGDirectionLTR);
  float contentWidth = YGNodeLayoutGetWidth(content);
  float measuredWidth = undefined ? contentWidth : holder.horizontal && widthMode == YGMeasureModeAtMost ? MIN(contentWidth, width) : width;
  return YGSize{measuredWidth, YGNodeLayoutGetHeight(content)};
}

#pragma mark - Layout style

static void CHTDimension(YGNodeRef node, id value, void (*points)(YGNodeRef, float), void (*percent)(YGNodeRef, float), void (*automatic)(YGNodeRef))
{
  if ([value isKindOfClass:[NSNumber class]]) {
    points(node, [value floatValue]);
  } else if ([value isKindOfClass:[NSString class]]) {
    NSString *string = value;
    if ([string hasSuffix:@"%"])
      percent(node, [[string substringToIndex:string.length - 1] floatValue]);
    else if ([string isEqualToString:@"auto"] && automatic)
      automatic(node);
  } else if (automatic) {
    automatic(node);
  } else {
    points(node, YGUndefined);
  }
}

static void CHTEdges(YGNodeRef node, NSDictionary *style, NSString *prefix, void (*points)(YGNodeRef, YGEdge, float), void (*percent)(YGNodeRef, YGEdge, float))
{
  NSArray *keys = @[ prefix, [prefix stringByAppendingString:@"Horizontal"], [prefix stringByAppendingString:@"Vertical"], [prefix stringByAppendingString:@"Top"],
                     [prefix stringByAppendingString:@"Right"], [prefix stringByAppendingString:@"Bottom"], [prefix stringByAppendingString:@"Left"] ];
  const YGEdge edges[] = {YGEdgeAll, YGEdgeHorizontal, YGEdgeVertical, YGEdgeTop, YGEdgeRight, YGEdgeBottom, YGEdgeLeft};
  for (NSUInteger index = 0; index < keys.count; index++) {
    id value = style[keys[index]];
    if ([value isKindOfClass:[NSNumber class]]) {
      points(node, edges[index], [value floatValue]);
    } else if ([value isKindOfClass:[NSString class]] && [value hasSuffix:@"%"]) {
      percent(node, edges[index], [[value substringToIndex:[value length] - 1] floatValue]);
    } else {
      points(node, edges[index], YGUndefined);
    }
  }
}

static YGAlign CHTAlign(NSString *value, YGAlign fallback)
{
  if ([value isEqualToString:@"flex-start"])
    return YGAlignFlexStart;
  if ([value isEqualToString:@"flex-end"])
    return YGAlignFlexEnd;
  if ([value isEqualToString:@"center"])
    return YGAlignCenter;
  if ([value isEqualToString:@"stretch"])
    return YGAlignStretch;
  if ([value isEqualToString:@"baseline"])
    return YGAlignBaseline;
  if ([value isEqualToString:@"auto"])
    return YGAlignAuto;
  return fallback;
}

static void CHTPositionPoints(YGNodeRef node, float value, YGEdge edge)
{
  YGNodeStyleSetPosition(node, edge, value);
}

/// React Native's flexbox subset, in points, applied to a Yoga node.
static void CHTApplyLayoutStyle(YGNodeRef node, NSDictionary *style)
{
  NSString *direction = CHTString(style[@"flexDirection"]);
  YGNodeStyleSetFlexDirection(node, [direction isEqualToString:@"row"] ? YGFlexDirectionRow
                                    : [direction isEqualToString:@"row-reverse"] ? YGFlexDirectionRowReverse
                                    : [direction isEqualToString:@"column-reverse"] ? YGFlexDirectionColumnReverse
                                                                                    : YGFlexDirectionColumn);
  NSString *justify = CHTString(style[@"justifyContent"]);
  YGNodeStyleSetJustifyContent(node, [justify isEqualToString:@"center"] ? YGJustifyCenter
                                     : [justify isEqualToString:@"flex-end"] ? YGJustifyFlexEnd
                                     : [justify isEqualToString:@"space-between"] ? YGJustifySpaceBetween
                                     : [justify isEqualToString:@"space-around"] ? YGJustifySpaceAround
                                     : [justify isEqualToString:@"space-evenly"] ? YGJustifySpaceEvenly
                                                                                 : YGJustifyFlexStart);
  YGNodeStyleSetAlignItems(node, CHTAlign(CHTString(style[@"alignItems"]), YGAlignStretch));
  YGNodeStyleSetAlignSelf(node, CHTAlign(CHTString(style[@"alignSelf"]), YGAlignAuto));
  YGNodeStyleSetAlignContent(node, CHTAlign(CHTString(style[@"alignContent"]), YGAlignFlexStart));
  YGNodeStyleSetFlexWrap(node, [CHTString(style[@"flexWrap"]) isEqualToString:@"wrap"] ? YGWrapWrap : YGWrapNoWrap);
  YGNodeStyleSetPositionType(node, [CHTString(style[@"position"]) isEqualToString:@"absolute"] ? YGPositionTypeAbsolute : YGPositionTypeRelative);
  YGNodeStyleSetDisplay(node, [CHTString(style[@"display"]) isEqualToString:@"none"] ? YGDisplayNone : YGDisplayFlex);
  YGNodeStyleSetOverflow(node, [CHTString(style[@"overflow"]) isEqualToString:@"hidden"] ? YGOverflowHidden : YGOverflowVisible);
  NSNumber *flex = CHTNumber(style[@"flex"]);
  BOOL flexes = flex && flex.floatValue > 0;
  YGNodeStyleSetFlexGrow(node, CHTNumber(style[@"flexGrow"]) ? [style[@"flexGrow"] floatValue] : flexes ? flex.floatValue : 0);
  YGNodeStyleSetFlexShrink(node, CHTNumber(style[@"flexShrink"]) ? [style[@"flexShrink"] floatValue] : flexes ? 1 : 0);
  if (style[@"flexBasis"])
    CHTDimension(node, style[@"flexBasis"], YGNodeStyleSetFlexBasis, YGNodeStyleSetFlexBasisPercent, YGNodeStyleSetFlexBasisAuto);
  else if (flexes)
    YGNodeStyleSetFlexBasis(node, 0);
  else
    YGNodeStyleSetFlexBasisAuto(node);
  CHTDimension(node, style[@"width"], YGNodeStyleSetWidth, YGNodeStyleSetWidthPercent, YGNodeStyleSetWidthAuto);
  CHTDimension(node, style[@"height"], YGNodeStyleSetHeight, YGNodeStyleSetHeightPercent, YGNodeStyleSetHeightAuto);
  CHTDimension(node, style[@"minWidth"], YGNodeStyleSetMinWidth, YGNodeStyleSetMinWidthPercent, nullptr);
  CHTDimension(node, style[@"minHeight"], YGNodeStyleSetMinHeight, YGNodeStyleSetMinHeightPercent, nullptr);
  CHTDimension(node, style[@"maxWidth"], YGNodeStyleSetMaxWidth, YGNodeStyleSetMaxWidthPercent, nullptr);
  CHTDimension(node, style[@"maxHeight"], YGNodeStyleSetMaxHeight, YGNodeStyleSetMaxHeightPercent, nullptr);
  NSNumber *aspectRatio = CHTNumber(style[@"aspectRatio"]);
  YGNodeStyleSetAspectRatio(node, aspectRatio ? aspectRatio.floatValue : YGUndefined);
  CHTEdges(node, style, @"margin", YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent);
  CHTEdges(node, style, @"padding", YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent);
  NSArray *positions = @[ @"top", @"right", @"bottom", @"left" ];
  const YGEdge positionEdges[] = {YGEdgeTop, YGEdgeRight, YGEdgeBottom, YGEdgeLeft};
  for (NSUInteger index = 0; index < positions.count; index++) {
    id value = style[positions[index]];
    if ([value isKindOfClass:[NSNumber class]])
      CHTPositionPoints(node, [value floatValue], positionEdges[index]);
    else if ([value isKindOfClass:[NSString class]] && [value hasSuffix:@"%"])
      YGNodeStyleSetPositionPercent(node, positionEdges[index], [[value substringToIndex:[value length] - 1] floatValue]);
    else
      CHTPositionPoints(node, YGUndefined, positionEdges[index]);
  }
  NSArray *borders = @[ @"borderWidth", @"borderTopWidth", @"borderRightWidth", @"borderBottomWidth", @"borderLeftWidth" ];
  const YGEdge borderEdges[] = {YGEdgeAll, YGEdgeTop, YGEdgeRight, YGEdgeBottom, YGEdgeLeft};
  for (NSUInteger index = 0; index < borders.count; index++) {
    NSNumber *value = CHTNumber(style[borders[index]]);
    YGNodeStyleSetBorder(node, borderEdges[index], value ? value.floatValue : YGUndefined);
  }
  NSNumber *gap = CHTNumber(style[@"gap"]);
  NSNumber *rowGap = CHTNumber(style[@"rowGap"]);
  NSNumber *columnGap = CHTNumber(style[@"columnGap"]);
  YGNodeStyleSetGap(node, YGGutterAll, gap ? gap.floatValue : YGUndefined);
  YGNodeStyleSetGap(node, YGGutterRow, rowGap ? rowGap.floatValue : YGUndefined);
  YGNodeStyleSetGap(node, YGGutterColumn, columnGap ? columnGap.floatValue : YGUndefined);
}

#pragma mark - Reconciler

/// Builds and updates native views from JS node trees, reusing views by position, type, and id so
/// a streamed Markdown view keeps its segments, selection, and scroll between updates.
@interface CHTReconciler : NSObject
@property (nonatomic, weak) CHTRowView *row;
/// Leaves with measure functions; Yoga only lets these be marked dirty.
- (const std::vector<YGNodeRef> &)measuredNodes;
- (CHTHolder *)reconcile:(nullable CHTHolder *)current node:(NSDictionary *)raw;
- (void)collectMeasured:(CHTHolder *)root;
- (void)setAnimating:(BOOL)running holder:(CHTHolder *)holder;
@end

@interface CHTRowView ()
- (void)node:(NSString *)action nodeId:(nullable NSString *)nodeId payload:(nullable NSDictionary *)payload;
- (void)contentSizeChanged;
@end

@implementation CHTReconciler {
  std::vector<YGNodeRef> _measured;
}

- (const std::vector<YGNodeRef> &)measuredNodes
{
  return _measured;
}

- (void)collectMeasured:(CHTHolder *)root
{
  _measured.clear();
  [self collect:root];
}

- (void)collect:(CHTHolder *)holder
{
  if ([holder.type isEqualToString:@"text"] || [holder.type isEqualToString:@"markdown"] || [holder.type isEqualToString:@"scroll"])
    _measured.push_back(holder.yoga);
  for (CHTHolder *child in holder.children)
    [self collect:child];
  if (holder.content)
    [self collect:holder.content];
}

- (CHTHolder *)reconcile:(CHTHolder *)current node:(NSDictionary *)raw
{
  NSString *type = CHTString(raw[@"type"]) ?: @"view";
  NSString *nodeId = CHTString(raw[@"id"]);
  BOOL reusable = current && [current.type isEqualToString:type] && (current.nodeId == nodeId || [current.nodeId isEqualToString:nodeId]);
  if (reusable && [type isEqualToString:@"text"])
    reusable = ((CHTTextView *)current.view).selectable == CHTBool(raw[@"selectable"], NO);
  if (reusable && [type isEqualToString:@"scroll"])
    reusable = current.horizontal == CHTBool(raw[@"horizontal"], NO);
  CHTHolder *holder = reusable ? current : [self create:raw type:type nodeId:nodeId];
  [self update:holder node:raw];
  return holder;
}

- (CHTHolder *)create:(NSDictionary *)raw type:(NSString *)type nodeId:(NSString *)nodeId
{
  CHTHolder *holder = [CHTHolder new];
  holder.type = type;
  holder.nodeId = nodeId;
  YGNodeSetContext(holder.yoga, (__bridge void *)holder);
  __weak CHTReconciler *weakSelf = self;
  if ([type isEqualToString:@"text"]) {
    holder.view = [[CHTTextView alloc] initSelectable:CHTBool(raw[@"selectable"], NO)];
    YGNodeSetMeasureFunc(holder.yoga, CHTMeasureLeaf);
  } else if ([type isEqualToString:@"markdown"]) {
    Class markdownClass = CHTMarkdownClass();
    if (markdownClass) {
      UIView<CHTMarkdownHost> *markdown = [[markdownClass alloc] initWithFrame:CGRectZero];
      [markdown cohub_setLinkHandler:^(NSString *url) {
        [weakSelf.row node:@"link" nodeId:nil payload:@{@"url" : url ?: @""}];
      }
          longPressHandler:^(NSString *url) {
            [weakSelf.row node:@"linkLongPress" nodeId:nil payload:@{@"url" : url ?: @""}];
          }
          heightHandler:^{
            [weakSelf.row contentSizeChanged];
          }];
      holder.view = markdown;
    } else {
      // A binary without the Markdown host methods still shows the text.
      holder.view = [[CHTTextView alloc] initSelectable:YES];
    }
    YGNodeSetMeasureFunc(holder.yoga, CHTMeasureLeaf);
  } else if ([type isEqualToString:@"vector"]) {
    holder.view = [CHTVectorView new];
  } else if ([type isEqualToString:@"image"]) {
    holder.view = [CHTImageView new];
  } else if ([type isEqualToString:@"scroll"]) {
    BOOL horizontal = CHTBool(raw[@"horizontal"], NO);
    holder.horizontal = horizontal;
    UIScrollView *scroll = [UIScrollView new];
    scroll.showsHorizontalScrollIndicator = NO;
    scroll.showsVerticalScrollIndicator = !horizontal;
    scroll.alwaysBounceHorizontal = horizontal;
    scroll.directionalLockEnabled = YES;
    scroll.scrollsToTop = NO;
    holder.view = scroll;
    holder.content = [self create:@{@"type" : @"view"} type:@"view" nodeId:nil];
    [scroll addSubview:holder.content.view];
    YGNodeSetMeasureFunc(holder.yoga, CHTMeasureScroll);
  } else {
    CHTBoxView *box = [CHTBoxView new];
    box.onAction = ^(NSString *action, NSString *actionNodeId, NSDictionary *payload) {
      [weakSelf.row node:action nodeId:actionNodeId payload:payload];
    };
    holder.view = box;
  }
  return holder;
}

- (void)update:(CHTHolder *)holder node:(NSDictionary *)raw
{
  NSDictionary *previous = holder.raw;
  holder.raw = raw;
  NSDictionary *style = CHTDict(raw[@"style"]) ?: @{};
  NSDictionary *previousStyle = CHTDict(previous[@"style"]) ?: @{};
  if (!previous || ![previousStyle isEqual:style])
    CHTApplyLayoutStyle(holder.yoga, style);
  UIView *view = holder.view;
  if ([view isKindOfClass:[CHTBoxView class]]) {
    [(CHTBoxView *)view applyNode:raw];
    [self reconcileChildren:holder nodes:CHTArray(raw[@"children"]) ?: @[] group:view];
  } else if ([view isKindOfClass:[CHTTextView class]]) {
    if (![previous isEqual:raw]) {
      if ([holder.type isEqualToString:@"markdown"])
        [(CHTTextView *)view applyNode:@{@"value" : CHTString(raw[@"markdown"]) ?: @"", @"text" : @{@"fontSize" : @17}}];
      else
        [(CHTTextView *)view applyNode:raw];
    }
  } else if ([holder.type isEqualToString:@"markdown"]) {
    if (![previous isEqual:raw])
      [self applyMarkdown:(UIView<CHTMarkdownHost> *)view node:raw];
  } else if ([view isKindOfClass:[CHTVectorView class]]) {
    [(CHTVectorView *)view applyNode:raw];
  } else if ([view isKindOfClass:[CHTImageView class]]) {
    [(CHTImageView *)view applyNode:raw];
  } else if ([view isKindOfClass:[UIScrollView class]]) {
    NSMutableDictionary *content = [@{@"type" : @"view", @"style" : CHTDict(raw[@"contentStyle"]) ?: @{}} mutableCopy];
    if (raw[@"children"])
      content[@"children"] = raw[@"children"];
    [self update:holder.content node:content];
  }
  if (![view isKindOfClass:[CHTBoxView class]] && ![view isKindOfClass:[CHTImageView class]])
    view.alpha = (CHTNumber(style[@"opacity"]) ?: @1).doubleValue;
  [self applyAccessibility:view node:raw];
  [self applyAnimations:holder node:raw];
}

- (void)applyMarkdown:(UIView<CHTMarkdownHost> *)view node:(NSDictionary *)raw
{
  NSMutableDictionary *props = [CHTMarkdownDefaults() mutableCopy];
  props[@"markdown"] = CHTString(raw[@"markdown"]) ?: @"";
  if (CHTDict(raw[@"markdownStyle"]))
    props[@"markdownStyle"] = raw[@"markdownStyle"];
  if (CHTDict(raw[@"md4cFlags"]))
    props[@"md4cFlags"] = raw[@"md4cFlags"];
  props[@"isGFM"] = @(CHTBool(raw[@"gfm"], YES));
  props[@"selectable"] = @(CHTBool(raw[@"selectable"], YES));
  BOOL streaming = CHTBool(raw[@"streaming"], NO);
  props[@"streamingAnimation"] = @(streaming);
  props[@"enableBlockContextMenu"] = @(CHTBool(raw[@"blockContextMenu"], YES));
  [props addEntriesFromDictionary:CHTDict(raw[@"hostProps"]) ?: @{}];
  // Streamed text parses off the main thread and grows the row when it lands; settled text
  // renders on bind, so a recycled row is measured with its content.
  [view cohub_applyProps:props renderInline:!streaming];
}

- (void)applyAccessibility:(UIView *)view node:(NSDictionary *)raw
{
  NSString *label = CHTString(raw[@"accessibilityLabel"]);
  NSString *role = CHTString(raw[@"accessibilityRole"]);
  BOOL hidden = CHTBool(raw[@"accessibilityHidden"], NO);
  view.accessibilityElementsHidden = hidden;
  if ([view isKindOfClass:[CHTTextView class]] || [view isKindOfClass:[UIScrollView class]] || [raw[@"type"] isEqual:@"markdown"])
    return;
  view.isAccessibilityElement = !hidden && label.length > 0;
  view.accessibilityLabel = label;
  UIAccessibilityTraits traits = UIAccessibilityTraitNone;
  if ([role isEqualToString:@"button"])
    traits |= UIAccessibilityTraitButton;
  else if ([role isEqualToString:@"link"])
    traits |= UIAccessibilityTraitLink;
  else if ([role isEqualToString:@"header"])
    traits |= UIAccessibilityTraitHeader;
  else if ([role isEqualToString:@"progressbar"])
    traits |= UIAccessibilityTraitUpdatesFrequently;
  NSDictionary *state = CHTDict(raw[@"accessibilityState"]);
  if (CHTBool(state[@"disabled"], NO))
    traits |= UIAccessibilityTraitNotEnabled;
  view.accessibilityTraits = traits;
  id expanded = state[@"expanded"];
  view.accessibilityValue = expanded ? (CHTBool(expanded, NO) ? @"expanded" : @"collapsed") : nil;
}

- (void)applyAnimations:(CHTHolder *)holder node:(NSDictionary *)raw
{
  id signature = raw[@"animations"];
  if (holder.animationSignature == signature || [holder.animationSignature isEqual:signature])
    return;
  [self removeAnimations:holder];
  holder.animationSignature = signature;
  NSArray *animations = CHTArray(signature) ?: @[];
  [animations enumerateObjectsUsingBlock:^(id entry, NSUInteger index, BOOL *stop) {
    NSDictionary *animation = CHTDict(entry);
    if (animation)
      CHTAddAnimation(holder.view.layer, animation, [NSString stringWithFormat:@"cht-%lu", (unsigned long)index]);
  }];
}

- (void)removeAnimations:(CHTHolder *)holder
{
  NSUInteger count = CHTArray(holder.animationSignature).count;
  for (NSUInteger index = 0; index < count; index++)
    [holder.view.layer removeAnimationForKey:[NSString stringWithFormat:@"cht-%lu", (unsigned long)index]];
  holder.animationSignature = nil;
}

/// Loops stop while the row is off screen and start again when it returns.
- (void)setAnimating:(BOOL)running holder:(CHTHolder *)holder
{
  if (running) {
    if (holder.raw)
      [self applyAnimations:holder node:holder.raw];
  } else {
    [self removeAnimations:holder];
  }
  for (CHTHolder *child in holder.children)
    [self setAnimating:running holder:child];
  if (holder.content)
    [self setAnimating:running holder:holder.content];
}

- (void)reconcileChildren:(CHTHolder *)holder nodes:(NSArray *)nodes group:(UIView *)group
{
  NSArray<CHTHolder *> *old = [holder.children copy];
  NSMutableDictionary<NSString *, CHTHolder *> *byId = [NSMutableDictionary dictionary];
  for (CHTHolder *child in old)
    if (child.nodeId)
      byId[child.nodeId] = child;
  NSMutableArray<CHTHolder *> *next = [NSMutableArray arrayWithCapacity:nodes.count];
  NSHashTable *taken = [NSHashTable hashTableWithOptions:NSPointerFunctionsObjectPointerPersonality];
  [nodes enumerateObjectsUsingBlock:^(id entry, NSUInteger index, BOOL *stop) {
    NSDictionary *child = CHTDict(entry);
    if (!child)
      return;
    NSString *childId = CHTString(child[@"id"]);
    CHTHolder *reuse = nil;
    if (childId) {
      reuse = byId[childId];
      [byId removeObjectForKey:childId];
    } else if (index < old.count && old[index].nodeId == nil && ![taken containsObject:old[index]]) {
      reuse = old[index];
    }
    CHTHolder *made = [self reconcile:reuse node:child];
    [taken addObject:made];
    [next addObject:made];
  }];
  for (CHTHolder *stale in old) {
    if (![taken containsObject:stale])
      [stale.view removeFromSuperview];
  }
  [next enumerateObjectsUsingBlock:^(CHTHolder *child, NSUInteger index, BOOL *stop) {
    if (child.view.superview != group || index >= group.subviews.count || group.subviews[index] != child.view) {
      [child.view removeFromSuperview];
      [group insertSubview:child.view atIndex:index];
    }
  }];
  YGNodeRemoveAllChildren(holder.yoga);
  [next enumerateObjectsUsingBlock:^(CHTHolder *child, NSUInteger index, BOOL *stop) {
    // A reused child may still belong to the previous parent's Yoga node.
    YGNodeRef owner = YGNodeGetOwner(child.yoga);
    if (owner && owner != holder.yoga)
      YGNodeRemoveChild(owner, child.yoga);
    YGNodeInsertChild(holder.yoga, child.yoga, index);
  }];
  [holder.children setArray:next];
}

@end

/// Positions a holder's views from its computed Yoga layout. Bounds and center, not frame: a
/// flight animates a node's transform.
static void CHTApplyLayout(CHTHolder *holder)
{
  YGNodeRef yoga = holder.yoga;
  CGRect frame = CGRectMake(YGNodeLayoutGetLeft(yoga), YGNodeLayoutGetTop(yoga), YGNodeLayoutGetWidth(yoga), YGNodeLayoutGetHeight(yoga));
  UIView *view = holder.view;
  if ([view respondsToSelector:@selector(cohub_setFrame:)]) {
    [(id<CHTMarkdownHost>)view cohub_setFrame:frame];
  } else {
    view.bounds = CGRectMake(0, 0, frame.size.width, frame.size.height);
    view.center = CGPointMake(CGRectGetMidX(frame), CGRectGetMidY(frame));
  }
  if (holder.content) {
    YGNodeRef content = holder.content.yoga;
    YGNodeCalculateLayout(content, holder.horizontal ? YGUndefined : frame.size.width, YGUndefined, YGDirectionLTR);
    CHTApplyLayout(holder.content);
    ((UIScrollView *)view).contentSize = CGSizeMake(YGNodeLayoutGetWidth(content), YGNodeLayoutGetHeight(content));
  }
  for (CHTHolder *child in holder.children)
    CHTApplyLayout(child);
}

#pragma mark - Row

@implementation CHTRowView {
  CHTReconciler *_reconciler;
  CHTHolder *_root;
  CGFloat _layoutWidth;
  CGFloat _height;
  BOOL _dirty;
  BOOL _measuring;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _reconciler = [CHTReconciler new];
    _reconciler.row = self;
    _layoutWidth = -1;
    _dirty = YES;
    self.clipsToBounds = NO;
  }
  return self;
}

- (void)bindKey:(NSString *)key spec:(NSDictionary *)spec
{
  if (![self.key isEqualToString:key]) {
    self.key = key;
    [self.layer removeAllAnimations];
    self.transform = CGAffineTransformIdentity;
  }
  self.spec = spec;
  self.type = CHTString(spec[@"type"]) ?: @"row";
  NSDictionary *node = CHTDict(spec[@"node"]) ?: @{@"type" : @"view"};
  CHTHolder *previous = _root;
  CHTHolder *next = [_reconciler reconcile:previous node:node];
  if (next != previous) {
    [previous.view removeFromSuperview];
    [self addSubview:next.view];
    _root = next;
  }
  [_reconciler collectMeasured:next];
  self.alpha = CHTBool(spec[@"hidden"], NO) ? 0 : 1;
  _dirty = YES;
}

- (CGFloat)layoutForWidth:(CGFloat)width
{
  if (!_root)
    return 0;
  if (_dirty || width != _layoutWidth) {
    _measuring = YES;
    for (YGNodeRef node : [_reconciler measuredNodes])
      YGNodeMarkDirty(node);
    YGNodeCalculateLayout(_root.yoga, width, YGUndefined, YGDirectionLTR);
    CHTApplyLayout(_root);
    _height = YGNodeLayoutGetHeight(_root.yoga);
    _layoutWidth = width;
    _dirty = NO;
    _measuring = NO;
  }
  return _height;
}

- (UIView *)viewForNodeId:(NSString *)nodeId
{
  return _root ? [self find:_root nodeId:nodeId] : nil;
}

- (UIView *)find:(CHTHolder *)holder nodeId:(NSString *)nodeId
{
  if ([holder.nodeId isEqualToString:nodeId])
    return holder.view;
  for (CHTHolder *child in holder.children) {
    UIView *found = [self find:child nodeId:nodeId];
    if (found)
      return found;
  }
  return holder.content ? [self find:holder.content nodeId:nodeId] : nil;
}

- (void)setAnimating:(BOOL)animating
{
  if (_root)
    [_reconciler setAnimating:animating holder:_root];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  [self setAnimating:self.window != nil];
}

- (void)node:(NSString *)action nodeId:(NSString *)nodeId payload:(NSDictionary *)payload
{
  [self.delegate row:self action:action nodeId:nodeId payload:payload];
}

// A Markdown view finished rendering at a different height: Yoga must measure the leaves again.
- (void)contentSizeChanged
{
  if (_measuring)
    return;
  _dirty = YES;
  [self.delegate rowNeedsLayout:self];
}

@end
