const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { signUpdate } = require("../scripts/sign-update.cjs");
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bf-sign-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const installer = path.join(
    directory,
    "Backstage-Forever-0.2.0-Windows-x64-Setup.exe",
  );
  await fs.writeFile(installer, "fixture installer");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    installer,
    version: "0.2.0",
    privateKey,
    publicKey,
    publishedAt: "2026-11-09T01:00:00.000Z",
  };
}
test("signs exact payload bytes and binds installer hash, size and release", async (t) => {
  const input = await fixture(t);
  const envelope = await signUpdate(input);
  assert.deepEqual(Object.keys(envelope), ["payload", "signature"]);
  const bytes = Buffer.from(envelope.payload, "base64");
  assert.equal(
    crypto.verify(
      null,
      bytes,
      input.publicKey,
      Buffer.from(envelope.signature, "base64"),
    ),
    true,
  );
  assert.deepEqual(JSON.parse(bytes), {
    schemaVersion: 1,
    version: "0.2.0",
    releaseTag: "v0.2.0",
    url: "https://github.com/farena-ai/Backstage-Forever/releases/download/v0.2.0/Backstage-Forever-0.2.0-Windows-x64-Setup.exe",
    sha256: crypto
      .createHash("sha256")
      .update("fixture installer")
      .digest("hex"),
    size: 17,
    publishedAt: input.publishedAt,
  });
  assert.equal(
    crypto.verify(
      null,
      Buffer.from(bytes.toString().replace("0.2.0", "0.3.0")),
      input.publicKey,
      Buffer.from(envelope.signature, "base64"),
    ),
    false,
  );
});
test("rejects noncanonical versions and mismatched installer names", async (t) => {
  const input = await fixture(t);
  for (const version of [
    "v0.2.0",
    "01.2.0",
    "0.2.0-beta",
    "../0.2.0",
    "0.2.0\n",
  ])
    await assert.rejects(signUpdate({ ...input, version }), /version/i);
  await assert.rejects(signUpdate({ ...input, version: "0.3.0" }), /filename/i);
});
test("rejects missing, mismatched and non-Ed25519 signing keys", async (t) => {
  const input = await fixture(t);
  await assert.rejects(signUpdate({ ...input, privateKey: undefined }), /key/i);
  await assert.rejects(
    signUpdate({
      ...input,
      publicKey: crypto.generateKeyPairSync("ed25519").publicKey,
    }),
    /match/i,
  );
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  await assert.rejects(signUpdate({ ...input, ...rsa }), /Ed25519/i);
});
test("rejects empty installers and invalid publication timestamps", async (t) => {
  const input = await fixture(t);
  await assert.rejects(
    signUpdate({ ...input, publishedAt: "yesterday" }),
    /timestamp/i,
  );
  await fs.writeFile(input.installer, "");
  await assert.rejects(signUpdate(input), /size/i);
});
test("rejects installers larger than the client 512 MiB limit before reading", async (t) => {
  const input = await fixture(t);
  await fs.truncate(input.installer, 512 * 1024 * 1024 + 1);
  await assert.rejects(signUpdate(input), /size/i);
});
