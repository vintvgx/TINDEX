export default {
  expo: {
    name: "alethia",
    slug: "alethia",
    version: "0.0.28",
    orientation: "portrait",
    icon: "./assets/logo/tindex_logo.png",
    scheme: "mobile",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    notification: {
      icon: "./assets/logo/tindex_logo.png",
    },
    ios: {
      supportsTablet: true,
      icon: "./assets/logo/tindex_logo.png",
      // preview
      // bundleIdentifier: "com.communite.tindex",
      // dev
      bundleIdentifier: "com.communite.alethia",
      usesAppleSignIn: true,
      simulator: true,
      infoPlist: {
        CFBundleURLTypes: [
          {
            CFBundleURLSchemes: [
              "com.googleusercontent.apps.1064184478567-3n1pm51cp4bm56nmruhvt5tpi0fulkqv"
            ]
          }
        ],
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      edgeToEdgeEnabled: true,
      package: "com.communite.alethia"
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      "expo-router",
      "expo-web-browser",
      [
        "expo-splash-screen",
        {
          image: "./assets/logo/tindex_logo.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#000000"
        }
      ],
      [
        "expo-secure-store",
        {
          configureAndroidBackup: true,
          faceIDPermission: "Allow $(PRODUCT_NAME) to access your Face ID biometric data."
        }
      ],
      [
        "expo-apple-authentication"
      ],
      [
        "@react-native-google-signin/google-signin",
        {
          iosUrlScheme: "com.googleusercontent.apps.49402666160-hrdp0lalkae29cjs5biltjbv9cbc2tsb"
        }
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/icons/notification_icon.png",
          color: "#ffffff",
          sounds: ["./assets/sounds/notification_sound.wav"],
        }
      ]
    ],
    experiments: {
      typedRoutes: true
    },
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      router: {},
      eas: {
        projectId: "8f0f6373-436d-4513-a93d-a3ecd1caed6e"
      }
    }
  }
}; 