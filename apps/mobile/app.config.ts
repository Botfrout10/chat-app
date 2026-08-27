export default {
  expo: {
    name: "Pulse",
    slug: "pulse-chat",
    scheme: "pulse",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "dev.pulse.chat",
    },
    android: {
      package: "dev.pulse.chat",
      // keyboard must not cover inputs: resize the window instead of panning
      softwareKeyboardLayoutMode: "resize",
      usesCleartextTraffic: true,
    },
    web: {
      bundler: "metro",
      output: "single",
    },
    plugins: [
      "expo-router",
      "expo-status-bar",
      "expo-secure-store",
      ["expo-image-picker", { photosPermission: "Allow Pulse to access your photos to share them in chat." }],
    ],
    experiments: {
      typedRoutes: false,
    },
  },
};
