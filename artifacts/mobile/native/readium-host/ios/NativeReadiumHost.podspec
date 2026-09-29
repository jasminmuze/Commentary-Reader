Pod::Spec.new do |s|
  s.name         = 'NativeReadiumHost'
  s.version      = '1.0.0'
  s.summary      = 'Embedded Readium EPUB reader bridge for React Native (Shelfmates).'
  s.description  = 'Hosts the Readium Swift toolkit EPUB navigator inside a React Native view, mirroring the Android readium-host bridge contract.'
  s.homepage     = 'https://shelfmates.app'
  s.license      = { :type => 'MIT' }
  s.author       = { 'Shelfmates' => 'dev@shelfmates.app' }
  s.platform     = :ios, '15.1'
  s.swift_version = '5.10'
  s.source       = { :path => '.' }
  s.source_files = '*.{swift,h,m}'

  s.dependency 'React-Core'
  s.dependency 'ReadiumShared', '~> 3.1.0'
  s.dependency 'ReadiumStreamer', '~> 3.1.0'
  s.dependency 'ReadiumNavigator', '~> 3.1.0'
  s.dependency 'ReadiumAdapterGCDWebServer', '~> 3.1.0'
end
