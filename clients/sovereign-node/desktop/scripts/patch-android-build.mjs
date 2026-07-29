#!/usr/bin/env node
/**
 * Apply stable Android Gradle pins after `tauri android init`.
 * Re-run if you regenerate the Android project.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const androidRoot = path.resolve(__dirname, '../src-tauri/gen/android')
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')

if (!fs.existsSync(androidRoot)) {
  console.error('Run `npm run android:init` first.')
  process.exit(1)
}

const localProps = path.join(androidRoot, 'local.properties')
if (sdk && fs.existsSync(sdk)) {
  const escaped = sdk.replace(/\\/g, '\\\\')
  fs.writeFileSync(localProps, `sdk.dir=${escaped}\n`)
  console.log('Wrote', localProps)
} else {
  console.warn('ANDROID_HOME not set; create local.properties manually.')
}

const agp = '8.9.2'
for (const file of [
  'build.gradle.kts',
  'buildSrc/build.gradle.kts',
]) {
  const p = path.join(androidRoot, file)
  if (!fs.existsSync(p)) continue
  const next = fs
    .readFileSync(p, 'utf8')
    .replace(/com\.android\.tools\.build:gradle:[\d.]+/g, `com.android.tools.build:gradle:${agp}`)
  fs.writeFileSync(p, next)
}

const appGradle = path.join(androidRoot, 'app/build.gradle.kts')
if (fs.existsSync(appGradle)) {
  let text = fs.readFileSync(appGradle, 'utf8')
  text = text.replace(
    /manifestPlaceholders\["usesCleartextTraffic"\] = "false"/,
    'manifestPlaceholders["usesCleartextTraffic"] = "true"'
  )
  text = text.replace(
    /implementation\("androidx\.webkit:webkit:[^"]+"\)/,
    'implementation("androidx.webkit:webkit:1.12.1")'
  )
  text = text.replace(
    /implementation\("androidx\.appcompat:appcompat:[^"]+"\)/,
    'implementation("androidx.appcompat:appcompat:1.7.0")'
  )
  text = text.replace(
    /implementation\("androidx\.activity:activity-ktx:[^"]+"\)/,
    'implementation("androidx.activity:activity-ktx:1.9.3")'
  )
  text = text.replace(
    /implementation\("com\.google\.android\.material:material:[^"]+"\)/,
    'implementation("com.google.android.material:material:1.12.0")'
  )
  text = text.replace(
    /implementation\("androidx\.lifecycle:lifecycle-process:[^"]+"\)/,
    'implementation("androidx.lifecycle:lifecycle-process:2.8.7")'
  )
  fs.writeFileSync(appGradle, text)
}

console.log('Android Gradle patches applied.')
