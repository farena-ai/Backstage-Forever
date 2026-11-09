"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Writable } = require("node:stream");
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
async function signUpdate({
  installer,
  version,
  privateKey,
  publicKey,
  publishedAt = new Date().toISOString(),
}) {
  if (typeof version !== "string" || !VERSION.test(version))
    throw new Error("Invalid strict release version");
  const filename = `Backstage-Forever-${version}-Windows-x64-Setup.exe`;
  if (path.basename(installer) !== filename)
    throw new Error("Installer filename must match release version");
  if (
    typeof publishedAt !== "string" ||
    !Number.isFinite(Date.parse(publishedAt)) ||
    new Date(publishedAt).toISOString() !== publishedAt
  )
    throw new Error("Invalid ISO publication timestamp");
  if (!privateKey || !publicKey)
    throw new Error("Signing and public keys are required");
  let secret, pinned;
  try {
    secret =
      privateKey instanceof crypto.KeyObject
        ? privateKey
        : crypto.createPrivateKey(privateKey);
    pinned =
      publicKey instanceof crypto.KeyObject
        ? publicKey
        : crypto.createPublicKey(publicKey);
  } catch {
    throw new Error("Invalid signing key configuration");
  }
  if (
    secret.type !== "private" ||
    secret.asymmetricKeyType !== "ed25519" ||
    pinned.type !== "public" ||
    pinned.asymmetricKeyType !== "ed25519"
  )
    throw new Error("Signing keys must be Ed25519");
  if (
    !crypto
      .createPublicKey(secret)
      .export({ type: "spki", format: "der" })
      .equals(pinned.export({ type: "spki", format: "der" }))
  )
    throw new Error("Signing key does not match bundled public key");
  const handle = await fsp.open(installer, "r");
  let size = 0;
  const hash = crypto.createHash("sha256");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 512 * 1024 * 1024)
      throw new Error("Invalid installer size or file type");
    await pipeline(
      handle.createReadStream({ autoClose: false }),
      new Writable({
        write(chunk, encoding, done) {
          size += chunk.length;
          hash.update(chunk);
          done();
        },
      }),
    );
    const after = await handle.stat();
    if (
      size !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs
    )
      throw new Error("Installer changed during signing");
  } finally {
    await handle.close();
  }
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      version,
      releaseTag: `v${version}`,
      url: `https://github.com/farena-ai/Backstage-Forever/releases/download/v${version}/${filename}`,
      sha256: hash.digest("hex"),
      size,
      publishedAt,
    }),
    "utf8",
  );
  return {
    payload: payload.toString("base64"),
    signature: crypto.sign(null, payload, secret).toString("base64"),
  };
}
async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (
      !["--installer", "--version", "--output"].includes(argv[i]) ||
      !argv[i + 1] ||
      Object.hasOwn(options, argv[i].slice(2))
    )
      throw new Error(
        "Usage: sign-update.cjs --installer <exe> --version <x.y.z> --output <json>",
      );
    options[argv[i].slice(2)] = argv[i + 1];
  }
  if (!options.installer || !options.version || !options.output)
    throw new Error("Installer, version and output are required");
  const envelope = await signUpdate({
    ...options,
    privateKey: process.env.BF_UPDATE_SIGNING_KEY,
    publicKey: await fsp.readFile(
      path.join(__dirname, "../assets/update-public-key.pem"),
      "utf8",
    ),
  });
  await fsp.writeFile(
    options.output,
    `${JSON.stringify(envelope, null, 2)}\n`,
    { flag: "wx" },
  );
  console.log("Signed update manifest written.");
}
module.exports = { signUpdate, main };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
