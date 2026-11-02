Pod::Spec.new do |s|
  s.name           = 'CohubChatTimeline'
  s.version        = '1.0.0'
  s.summary        = 'The Cohub Chat timeline drawn natively.'
  s.description    = 'A virtualized Chat timeline whose rows are node trees described in JS and laid out with Yoga.'
  s.license        = 'Apache-2.0'
  s.author         = 'Cohub'
  s.homepage       = 'https://github.com/markbang/cohub-mobile'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Rows are laid out with React Native's flexbox.
  s.dependency 'Yoga'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
  # Swift sees only the timeline view; the row engine stays internal.
  s.public_header_files = 'CHTTimelineView.h'
  s.private_header_files = 'CHTRow.h'
end
