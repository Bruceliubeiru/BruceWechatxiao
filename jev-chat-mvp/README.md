# Jev Chat Copilot — privacy-first Android prototype

**Status:** source prototype; **not** a verified APK, native on-device generative model, or completed dual-mode product.

This isolated module lives in `jev-chat-mvp/` and must not be confused with the `android-offline/` Prescript terminal or upstream `jev-chat/jev-chat-jarvis` v1.7.

## Deliberate, testable scope

1. Android share target for `text/plain`, single `image/*`, multiple `image/*`; direct paste also works.
2. OCR via bundled ML Kit Chinese recognizer runs on-device; results are editable. OCR does **not** automatically identify who said what or guarantee chronological order.
3. Mode A produces a grounded **reply-analysis request**; Mode B produces an independent **self-audit request**. User may copy or share it to an existing AI chat app and **must manually submit**.
4. No API key, `INTERNET` permission, accessibility service, surveillance, automatic message sending, or background chat persistence. The app does not contain a generative LLM. Sending to another AI service is a separate, user-controlled step subject to that service's privacy policy/limits.
5. Screenshots are guarded by `FLAG_SECURE` within this prototype. Android clipboard is OS-managed and out of the app's control.

## Limits / open blockers

- **Critical:** no on-device LLM. The analysis itself is performed only when the user manually submits the generated request to an external existing AI app. Thus end-to-end offline A/B analysis is **not complete**.
- The target AI app's `ACTION_SEND` support is not guaranteed; copy/paste is the fallback.
- OCR may mix speakers and ordering, and has to be checked by the user.
- Android build, install, share receive, bundled OCR and compatibility remain **UNKNOWN** until Android SDK/Gradle build and real-device tests.
- App deliberately does not embed the upstream APK or use its branding as evidence of own features.

## Build (local, no cloud CI)

Install JDK 17, Android SDK 35 and Gradle 8.9, then run `gradle assembleDebug` from `jev-chat-mvp/`. Debug APK would appear under `app/build/outputs/apk/debug/` **only if** build succeeds. Building locally may download standard Android dependencies; those downloads are not paid services. No GitHub Actions workflow is created or invoked.

## Source-only checks

Run these without Android SDK:

```sh
mkdir -p /tmp/jev-classes
javac -encoding UTF-8 -d /tmp/jev-classes app/src/main/java/io/jev/copilot/PromptComposer.java app/src/test/java/io/jev/copilot/PromptComposerTest.java
java -cp /tmp/jev-classes io.jev.copilot.PromptComposerTest
```

**Next gate:** local Android Gradle compilation, then permission audit and Android device evidence, then independent A/B quality benchmark. Avoid claiming delivery from source-only checks.
