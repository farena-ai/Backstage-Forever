# winget (Windows Package Manager)

Prepared manifests for `winget install BackstageCoding.BackstageForever`. **Nothing here is submitted
automatically.** The three `.yaml` files are written by `scripts/build-winget.cjs` from `package.json`;
do not edit them by hand.

The installer hash cannot come from the repo: it is the hash of the **signed** installer on the
GitHub release. Until the script is given one, `InstallerSha256` is all zeros and the manifest must
not be submitted.

## For each release (after the release is published)

1. Download `SHA256SUMS.txt` from the release page, then:

   ```
   node scripts/build-winget.cjs --sums path/to/SHA256SUMS.txt
   ```

   (`--sha256 <hash>` or `--installer path/to/Backstage-Forever-<version>-Windows-x64-Setup.exe` work too;
   `--version 1.2.3` writes another version than the one in `package.json`.)

2. Check the result on a Windows PC:

   ```
   winget validate --manifest packaging\winget
   winget install --manifest packaging\winget
   ```

   The second command needs local manifests switched on once:
   `winget settings --enable LocalManifestFiles` (in an administrator terminal).
   The app should install for the current user, start, and show the right version in Settings → Updates.

3. Submit by hand. Either:

   - `wingetcreate submit packaging\winget` (the tool asks for a GitHub sign-in and opens the pull request), or
   - fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs), copy the three files to
     `manifests/b/BackstageCoding/BackstageForever/<version>/`, and open a pull request.

   The first submission is reviewed by a person and can take a few days. Later versions are mostly automatic.

## Notes

- Installer type is `nullsoft` (the NSIS installer electron-builder makes), per user, silent switch `/S`.
- The app updates itself after installation; winget sees the newer version on its next upgrade check
  only when a manifest for that version has been merged, so submit each stable release.
- Only stable releases belong in winget. Do not submit previews.
- `node scripts/build-winget.cjs --check` says whether the files match `package.json`
  (it ignores the hash). It is not a CI gate.
