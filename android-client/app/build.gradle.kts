plugins {
  id("com.android.application")
}

val appVersionName = providers.gradleProperty("versionName").orElse("0.1.0")
val appVersionCode = providers.gradleProperty("versionCode").map(String::toInt).orElse(1)

val keystorePath = providers.environmentVariable("ANDROID_KEYSTORE_PATH")
val keystorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD")
val keyAliasValue = providers.environmentVariable("ANDROID_KEY_ALIAS")
val keyPasswordValue = providers.environmentVariable("ANDROID_KEY_PASSWORD")
val hasReleaseSigning = listOf(
  keystorePath,
  keystorePassword,
  keyAliasValue,
  keyPasswordValue,
).all { it.isPresent }

android {
  namespace = "com.aetherci.sorcerer.remote"
  compileSdk = 37

  defaultConfig {
    applicationId = "com.aetherci.sorcerer.remote"
    minSdk = 26
    targetSdk = 37
    versionCode = appVersionCode.get()
    versionName = appVersionName.get()

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    testInstrumentationRunnerArguments["clearPackageData"] = "true"
  }

  if (hasReleaseSigning) {
    signingConfigs {
      create("release") {
        storeFile = file(keystorePath.get())
        storePassword = keystorePassword.get()
        keyAlias = keyAliasValue.get()
        keyPassword = keyPasswordValue.get()
      }
    }
  }

  buildTypes {
    debug {
      applicationIdSuffix = ".debug"
      versionNameSuffix = "-debug"
    }
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro",
      )
      if (hasReleaseSigning) {
        signingConfig = signingConfigs.getByName("release")
      }
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    buildConfig = true
    viewBinding = true
  }

  testOptions {
    execution = "ANDROIDX_TEST_ORCHESTRATOR"
  }

  lint {
    abortOnError = true
    checkDependencies = true
    checkReleaseBuilds = true
    htmlReport = true
    sarifReport = true
    warningsAsErrors = false
  }

  packaging {
    resources.excludes += setOf(
      "META-INF/AL2.0",
      "META-INF/LGPL2.1",
      "META-INF/LICENSE.md",
      "META-INF/NOTICE.md",
    )
  }
}

dependencies {
  implementation("androidx.activity:activity-ktx:1.13.0")
  implementation("androidx.appcompat:appcompat:1.7.1")
  implementation("androidx.webkit:webkit:1.16.0")
  implementation("com.google.android.material:material:1.14.0")

  testImplementation("junit:junit:4.13.2")

  androidTestImplementation("androidx.test:core-ktx:1.7.0")
  androidTestImplementation("androidx.test.ext:junit-ktx:1.3.0")
  androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
  androidTestImplementation("androidx.test:runner:1.7.0")
  androidTestUtil("androidx.test:orchestrator:1.6.1")
}
