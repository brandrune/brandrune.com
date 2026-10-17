// PostHog: pageviews and referrer only. Loaded after /ph.js, same origin, so script-src stays 'self'.
// Not tracked: what you type or name, profiles, recordings, heatmaps, surveys.
posthog.init('phc_yRiGFewYfsT23FtahV67NoHb8Szip7ieLuKnYUmaEPqr', {
  api_host: 'https://us.i.posthog.com',
  defaults: '2025-05-24',
  person_profiles: 'identified_only',
  autocapture: false,
  capture_dead_clicks: false,
  capture_performance: false,
  enable_heatmaps: false,
  disable_session_recording: true,
  disable_surveys: true,
  // Self-hosting: no assets-host scripts, and no /flags/ call (we use no flags; remote config is unreachable anyway).
  disable_external_dependency_loading: true,
  advanced_disable_flags: true,
});
