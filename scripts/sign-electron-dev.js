#!/usr/bin/env node
/* eslint-env node */
/* global require, process, console */
//
// Ad-hoc-sign node_modules/electron/dist/Electron.app with the dev-time
// entitlements (camera + microphone + the standard Electron hardened-
// runtime relaxers).
//
// Why this exists
//   macOS's TCC subsystem refuses to fire the camera-permission prompt
//   for an unsigned binary. Electron ships its `Electron.app` unsigned
//   in node_modules; without this step `systemPreferences
//   .getMediaAccessStatus('camera')` is permanently `not-determined` and
//   getUserMedia silently delivers black frames in dev. Ad-hoc signing
//   (codesign --sign -) attaches a stable identity TCC can key off,
//   and the entitlements give camera/microphone access explicitly.
//
// Idempotent
//   Checks if Electron.app already carries our entitlements (a hash of
//   the entitlements file is stamped via xattr). Skips when nothing has
//   changed. Re-runs whenever entitlements.dev.plist is touched or the
//   Electron dependency is reinstalled.
//
// Only macOS — every other platform is a no-op.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

if (process.platform !== 'darwin') process.exit(0);

const repo = path.resolve(__dirname, '..');
const electronApp = path.join(repo, 'node_modules', 'electron', 'dist', 'Electron.app');
const entitlements = path.join(repo, 'electron', 'entitlements.dev.plist');
const stampAttr = 'com.pianokeys.dev-codesign-stamp';

function fail(msg) {
  console.error(`[sign-electron-dev] ${msg}`);
  process.exit(1);
}
function log(msg) {
  console.log(`[sign-electron-dev] ${msg}`);
}

if (!fs.existsSync(electronApp)) fail(`No Electron.app at ${electronApp} - run npm install first.`);
if (!fs.existsSync(entitlements)) fail(`No entitlements at ${entitlements}`);

// Bundle id rewrite.
//
// Electron ships every dev binary as `com.github.Electron` - a SHARED id
// across every Electron-based dev app on the machine. macOS's TCC keys
// permissions by bundle id, so a prior camera-deny under any of those
// apps lingers here too, and even a fresh tccutil reset can leave
// `not-determined` stuck because it's keyed to a binary whose code
// signing identity changes shape every time we re-sign ad-hoc. Rewriting
// the bundle id to something Piano-Keys-specific gives TCC a fresh row
// it has no history with.
const newBundleId = 'com.pianokeys.dev';

// Helper apps each have their own bundle id; per Apple's rules they
// must start with the parent app's id. Rewrite every Info.plist in the
// bundle (the parent + the four helpers).
function rewriteInfoPlist(infoPath, idPattern) {
  if (!fs.existsSync(infoPath)) return;
  let cur = '';
  try {
    cur = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', infoPath], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch { /* missing key - we'll add it */ }
  if (cur === idPattern) return;
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier ${idPattern}`, infoPath], { stdio: 'ignore' });
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :CFBundleIdentifier string ${idPattern}`, infoPath], { stdio: 'ignore' });
  }
  log(`Rewrote bundle id ${cur || '(missing)'} -> ${idPattern} in ${path.relative(repo, infoPath)}`);
}

rewriteInfoPlist(path.join(electronApp, 'Contents', 'Info.plist'), newBundleId);
const helpersDir = path.join(electronApp, 'Contents', 'Frameworks');
if (fs.existsSync(helpersDir)) {
  for (const entry of fs.readdirSync(helpersDir)) {
    if (!entry.endsWith('.app')) continue;
    const helperInfo = path.join(helpersDir, entry, 'Contents', 'Info.plist');
    // Helper id = parent id + a suffix derived from the helper name.
    const suffix = entry
      .replace(/^Electron Helper\s*/, '')
      .replace(/\.app$/, '')
      .replace(/[()\s]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    const helperId = suffix ? `${newBundleId}.helper.${suffix}` : `${newBundleId}.helper`;
    rewriteInfoPlist(helperInfo, helperId);
  }
}

// Stamp = sha1(entitlements file) — if Electron.app already carries this
// stamp under the xattr, the previous sign is current and we can skip.
const entitlementsHash = crypto
  .createHash('sha1')
  .update(fs.readFileSync(entitlements))
  .digest('hex');

let currentStamp = '';
try {
  currentStamp = execFileSync('xattr', ['-p', stampAttr, electronApp], { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  // Missing xattr is fine — first run.
}
// Force LaunchServices to re-scan the bundle every run. Without this
// re-registration, TCC keeps using a stale record of the bundle id and
// silently refuses to display the camera prompt after we've rewritten
// CFBundleIdentifier and re-signed ad-hoc.
try {
  execFileSync(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', electronApp],
    { stdio: 'ignore' },
  );
} catch (err) {
  log(`Warning: lsregister -f failed (${err}); TCC may not see the new bundle id.`);
}

if (currentStamp === entitlementsHash) {
  log('Electron.app already signed with current entitlements; skipping.');
  process.exit(0);
}

log('Re-signing Electron.app with camera + microphone entitlements…');
// `--force` to overwrite any prior signature; `--deep` so helper apps
// (Electron Helper.app etc.) get the same signature/entitlements; `--sign
// -` means ad-hoc (no Developer ID needed); `--options runtime` enables
// hardened runtime, which is what makes our entitlements actually do
// anything; `--timestamp=none` avoids hitting Apple's timestamp server in
// dev.
const result = spawnSync(
  'codesign',
  [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--options',
    'runtime',
    '--entitlements',
    entitlements,
    '--timestamp=none',
    electronApp,
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) fail(`codesign exited with status ${result.status}`);

// Stamp the bundle so subsequent runs short-circuit.
try {
  execFileSync('xattr', ['-w', stampAttr, entitlementsHash, electronApp], { stdio: 'ignore' });
} catch (err) {
  log(`Warning: could not write stamp xattr (${err}); idempotency will fall back to always-resign.`);
}

log('Done.');
