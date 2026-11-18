"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const timestamp = "http://timestamp.acs.microsoft.com";

function isFile(file) {
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
}

function findSigntool(env) {
  if (env.BF_SIGNTOOL) return path.resolve(env.BF_SIGNTOOL);
  const sdk = path.join(env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Windows Kits", "10", "bin");
  if (!fs.statSync(sdk, { throwIfNoEntry: false })?.isDirectory()) return undefined;
  return fs.readdirSync(sdk)
    .filter((version) => /^10\.\d+\.\d+\.\d+$/.test(version))
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
    .map((version) => path.join(sdk, version, "x64", "signtool.exe"))
    .find(isFile);
}

function signingSetup(env) {
  if (!env.BF_SIGN_DIR?.trim()) {
    throw new Error("Set BF_SIGN_DIR to the local Azure signing directory (metadata.json and dlib/).");
  }
  const dir = path.resolve(env.BF_SIGN_DIR);
  const metadata = path.join(dir, "metadata.json");
  const dlib = path.join(dir, "dlib", "bin", "x64", "Azure.CodeSigning.Dlib.dll");
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(metadata, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("BF_SIGN_DIR must contain a readable, valid metadata.json.");
  }
  if (profile?.Endpoint !== "https://eus.codesigning.azure.net" ||
      profile.CodeSigningAccountName !== "BackstageCoding" || profile.CertificateProfileName !== "public-release") {
    throw new Error("metadata.json must select the East US BackstageCoding/public-release signing profile.");
  }
  if (!isFile(dlib)) throw new Error("Missing dlib/bin/x64/Azure.CodeSigning.Dlib.dll in BF_SIGN_DIR.");
  const signtool = findSigntool(env);
  if (!signtool || !isFile(signtool)) {
    throw new Error("No x64 signtool.exe found. Install Windows SDK Signing Tools or set BF_SIGNTOOL.");
  }
  const azDir = path.join(env.ProgramFiles || "C:/Program Files", "Microsoft SDKs", "Azure", "CLI2", "wbin");
  const childEnv = { ...env };
  const pathKey = Object.keys(childEnv).find((key) => key.toLowerCase() === "path") || "Path";
  if (isFile(path.join(azDir, "az.cmd"))) {
    childEnv[pathKey] = [childEnv[pathKey], azDir].filter(Boolean).join(";");
  }
  return { metadata, dlib, signtool, childEnv };
}

// Only this entry point overrides the normal unsigned NSIS config. Inject the
// two side-effect boundaries so tests can exercise the wiring without a build.
async function run({ env = process.env, platform = process.platform, exec = execFileSync,
  build = (options) => require("electron-builder").build(options) } = {}) {
  if (platform !== "win32") throw new Error("Signed NSIS builds require Windows.");
  const { metadata, dlib, signtool, childEnv } = signingSetup(env);
  const sign = ({ path: file }) => {
    const name = path.basename(file);
    function invoke(args) {
      try {
        exec(signtool, args, { env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        const detail = Number.isInteger(error.status) ? `exit ${error.status}` : error.code || "no exit status";
        const hint = args[0] === "sign"
          ? "Check Azure CLI login, profile permissions, the x64 .NET runtime and timestamp connectivity."
          : "The file must have a valid Authenticode signature and timestamp.";
        throw new Error(`SignTool could not ${args[0]} ${name} (${detail}). ${hint}`);
      }
    }
    invoke(["sign", "/fd", "SHA256", "/tr", timestamp, "/td", "SHA256", "/dlib", dlib, "/dmdf", metadata, file]);
    // SignTool exits nonzero for warnings, including a missing timestamp (/tw).
    invoke(["verify", "/pa", "/tw", file]);
    console.log(`Signed and verified: ${name}`);
  };

  return build({
    projectDir: root,
    win: ["nsis"],
    x64: true,
    publish: "never",
    config: {
      directories: { output: "dist/signed" },
      win: {
        signExecutable: true,
        forceCodeSigning: true,
        cscLink: "", // Do not import an inherited CSC_LINK/WIN_CSC_LINK certificate.
        signtoolOptions: { sign, signingHashAlgorithms: ["sha256"] },
      },
    },
  });
}

if (require.main === module) {
  if (process.argv.length !== 2) {
    console.error("Usage: npm run dist:signed (no arguments)");
    process.exitCode = 1;
  } else {
    run().catch((error) => {
      console.error(`Signed NSIS build failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

module.exports = { run };