"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const pkg = require("../package.json");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "bf signing "));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dlib = path.join(dir, "dlib", "bin", "x64", "Azure.CodeSigning.Dlib.dll");
  const metadata = path.join(dir, "metadata.json");
  const signtool = path.join(dir, "signtool.exe");
  fs.mkdirSync(path.dirname(dlib), { recursive: true });
  fs.writeFileSync(dlib, "fixture, not a DLL");
  fs.writeFileSync(signtool, "fixture, not an executable");
  fs.writeFileSync(metadata, JSON.stringify({
    Endpoint: "https://eus.codesigning.azure.net",
    CodeSigningAccountName: "BackstageCoding",
    CertificateProfileName: "public-release",
  }));
  return { dlib, metadata, signtool, env: { BF_SIGN_DIR: dir, BF_SIGNTOOL: signtool } };
}

test("the signed NSIS command is separate from the unchanged unsigned paths", async (t) => {
  assert.equal(pkg.scripts.dist, "electron-builder --win nsis --x64 --publish never");
  assert.equal(pkg.scripts.pack, "electron-builder --win --dir");
  assert.equal(pkg.build.win.signExecutable, false);
  assert.equal(pkg.build.win.signtoolOptions, undefined);
  assert.equal(pkg.scripts["dist:signed"], "node scripts/dist-signed.cjs");
  const { run } = require("../scripts/dist-signed.cjs");
  const { env } = fixture(t);
  await run({ env, platform: "win32", build(options) {
    assert.deepEqual(options.win, ["nsis"]);
    assert.equal(options.x64, true);
    assert.equal(options.publish, "never");
    assert.equal(options.config.directories.output, "dist/signed");
    assert.equal(options.config.win.signExecutable, true);
    assert.equal(options.config.win.forceCodeSigning, true);
    assert.deepEqual(options.config.win.signtoolOptions.signingHashAlgorithms, ["sha256"]);
    assert.equal(typeof options.config.win.signtoolOptions.sign, "function");
  } });
});

test("missing or wrong local signing configuration stops before invoking the builder", async (t) => {
  const { run } = require("../scripts/dist-signed.cjs");
  const local = fixture(t);
  const options = { platform: "win32", env: local.env, build: () => assert.fail("builder invoked") };
  await assert.rejects(run({ ...options, platform: "linux" }), /Windows/);
  await assert.rejects(run({ ...options, env: {} }), /BF_SIGN_DIR/);
  fs.renameSync(local.metadata, `${local.metadata}.bak`);
  await assert.rejects(run(options), /metadata\.json/);
  fs.writeFileSync(local.metadata, '{"CertificateProfileName":"wrong"}');
  await assert.rejects(run(options), /BackstageCoding.*public-release/);
  fs.copyFileSync(local.metadata + ".bak", local.metadata);
  fs.unlinkSync(local.dlib);
  await assert.rejects(run(options), /Azure\.CodeSigning\.Dlib\.dll/);
});

test("the builder hook signs with Azure SHA-256 and verifies a timestamp for each file", async (t) => {
  const { run } = require("../scripts/dist-signed.cjs");
  const local = fixture(t);
  const calls = [];
  const files = ["win-unpacked/Backstage Forever.exe", "Setup.__uninstaller.exe", "Setup.exe"];
  await run({ env: local.env, platform: "win32", exec: (exe, args) => calls.push([exe, ...args]),
    async build({ config }) {
      for (const file of files) await config.win.signtoolOptions.sign({ path: file });
    },
  });
  assert.deepEqual(calls, files.flatMap((file) => [
    [local.signtool, "sign", "/fd", "SHA256", "/tr", "http://timestamp.acs.microsoft.com",
      "/td", "SHA256", "/dlib", local.dlib, "/dmdf", local.metadata, file],
    [local.signtool, "verify", "/pa", "/tw", file],
  ]));
});

test("SDK discovery finds the newest installed x64 SignTool and fails when none exists", async (t) => {
  const { run } = require("../scripts/dist-signed.cjs");
  const local = fixture(t);
  const sdk = path.join(local.env.BF_SIGN_DIR, "Windows Kits", "10", "bin");
  const env = { BF_SIGN_DIR: local.env.BF_SIGN_DIR, "ProgramFiles(x86)": local.env.BF_SIGN_DIR };
  await assert.rejects(run({ env, platform: "win32", build: () => assert.fail("builder invoked") }), /No x64 signtool/);
  function fakeTool(version, arch) {
    const file = path.join(sdk, version, arch, "signtool.exe");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "fixture, not an executable");
    return file;
  }
  fakeTool("10.0.9999.0", "x64");
  const newest = fakeTool("10.0.10000.0", "x64");
  fakeTool("10.0.10001.0", "x86");
  await run({ env, platform: "win32", exec: (exe) => assert.equal(exe, newest),
    build: ({ config }) => config.win.signtoolOptions.sign({ path: "Setup.exe" }),
  });
});

test("SignTool signing failures and verification warnings both propagate to the caller", async (t) => {
  const { run } = require("../scripts/dist-signed.cjs");
  const { env } = fixture(t);
  for (const operation of ["sign", "verify"]) {
    const seen = [];
    await assert.rejects(run({ env, platform: "win32", exec(_exe, [command]) {
      seen.push(command);
      if (command === operation) throw Object.assign(new Error("simulated failure"), { status: 2 });
    }, build: ({ config }) => config.win.signtoolOptions.sign({ path: "Setup.exe" }) }),
    new RegExp(`could not ${operation} Setup\\.exe.*exit 2`));
    assert.deepEqual(seen, operation === "sign" ? ["sign"] : ["sign", "verify"]);
  }
});