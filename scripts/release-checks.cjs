const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const YAML = require('yaml')
const { validateRelease } = require('./validate-release.cjs')
const { prepareReleaseAssets } = require('./prepare-release-assets.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sorcerer-release-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'docs', 'releases'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.8.0' }))
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.8.0', packages: { '': { version: '1.8.0' } } }))
  const notes = path.join(root, 'docs', 'releases', 'v1.8.0.md')
  fs.writeFileSync(notes, '# Sorcerer v1.8.0\n\nReleased: 2026-09-18\n\n## Highlights\n\n- New features.\n\n## Fixes and polish\n\n- Bug fixes.\n\n## Notes\n\n- Includes all changes since v1.7.22.\n')
  const directory = path.join(root, 'artifacts')
  fs.mkdirSync(directory)
  const assets = ['Sorcerer-1.8.0-win-x64.exe', 'Sorcerer-1.8.0-mac-arm64.dmg', 'Sorcerer-1.8.0-mac-x64.dmg', 'Sorcerer-1.8.0-linux-x86_64.AppImage']
  assets.push('Sorcerer-1.8.0-win-x64.exe.blockmap')
  for (const name of assets) fs.writeFileSync(path.join(directory, name), `fixture: ${name}`)
  for (const [name, installer] of [['latest.yml', assets[0]], ['latest-linux.yml', assets[3]]]) {
    const contents = fs.readFileSync(path.join(directory, installer))
    const sha512 = crypto.createHash('sha512').update(contents).digest('base64')
    fs.writeFileSync(path.join(directory, name), YAML.stringify({
      version: '1.8.0', files: [{ url: installer, sha512, size: contents.length }], path: installer, sha512,
      releaseDate: '2026-09-18T12:00:00.000Z'
    }))
    assets.push(name)
  }
  return { root, notes, directory, assets }
}

function changeManifest(directory, name, update) {
  const file = path.join(directory, name)
  const manifest = YAML.parse(fs.readFileSync(file, 'utf8'))
  update(manifest)
  fs.writeFileSync(file, YAML.stringify(manifest))
}

test('accepts matching committed metadata with or without an explicit tag', (t) => {
  const { root } = fixture(t)
  assert.equal(validateRelease(root).tag, 'v1.8.0')
  assert.equal(validateRelease(root, 'v1.8.0').notesPath, 'docs/releases/v1.8.0.md')
})

test('rejects a mismatched tag instead of rewriting the package version', (t) => {
  const { root } = fixture(t)
  assert.throws(() => validateRelease(root, 'v1.8.1'), /does not match/)
  assert.throws(() => validateRelease(root, 'v1.8.0-beta.1'), /does not match/)
})

test('rejects mismatches in either package lock version field', (t) => {
  const { root } = fixture(t)
  const lockFile = path.join(root, 'package-lock.json')
  for (const lock of [
    { version: '1.7.22', packages: { '': { version: '1.8.0' } } },
    { version: '1.8.0', packages: { '': { version: '1.7.22' } } }
  ]) {
    fs.writeFileSync(lockFile, JSON.stringify(lock))
    assert.throws(() => validateRelease(root), /version fields must match/)
  }
})

test('requires a stable version without leading zeros', (t) => {
  const { root } = fixture(t)
  for (const version of ['01.8.0', '1.8.0-beta.1', '1.8', '../1.8.0']) {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }))
    assert.throws(() => validateRelease(root), /MAJOR.MINOR.PATCH/)
  }
})

test('requires curated notes for this exact release', (t) => {
  const { root, notes } = fixture(t)
  fs.writeFileSync(notes, fs.readFileSync(notes, 'utf8').replace('# Sorcerer v1.8.0', '# Sorcerer v1.7.22'))
  assert.throws(() => validateRelease(root), /must start with/)
  fs.unlinkSync(notes)
  assert.throws(() => validateRelease(root), /ENOENT/)
})

test('requires a real calendar release date', (t) => {
  const { root, notes } = fixture(t)
  fs.writeFileSync(notes, fs.readFileSync(notes, 'utf8').replace('2026-09-18', '2026-02-30'))
  assert.throws(() => validateRelease(root), /valid Released/)
})

test('requires nonempty content under every mandatory heading', (t) => {
  const { root, notes } = fixture(t)
  const original = fs.readFileSync(notes, 'utf8')
  for (const title of ['Highlights', 'Fixes and polish', 'Notes']) {
    fs.writeFileSync(notes, original.replace(new RegExp(`(## ${title}\\n)[\\s\\S]*?(?=\\n## |$)`), '$1\n'))
    assert.throws(() => validateRelease(root), /nonempty/)
  }
})

test('rejects unresolved placeholders and accepts Windows line endings', (t) => {
  const { root, notes } = fixture(t)
  const original = fs.readFileSync(notes, 'utf8')
  fs.writeFileSync(notes, `${original}\n- TODO finish release.\n`)
  assert.throws(() => validateRelease(root), /template placeholders/)
  fs.writeFileSync(notes, original.replace(/\n/g, '\r\n'))
  assert.equal(validateRelease(root).version, '1.8.0')
})

test('validates updater metadata and produces deterministic checksums for every release asset', async (t) => {
  const { root, directory, assets } = fixture(t)
  assert.deepEqual(await prepareReleaseAssets(root, directory), [...assets].sort())
  const sums = fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8')
  for (const name of assets) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')
    assert.ok(sums.includes(`${hash}  ${name}\n`))
  }
  await prepareReleaseAssets(root, directory)
  assert.equal(fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8'), sums)
})

test('rejects an incomplete platform or architecture set', async (t) => {
  const { root, directory, assets } = fixture(t)
  fs.unlinkSync(path.join(directory, assets[0]))
  await assert.rejects(prepareReleaseAssets(root, directory), /Expected exactly/)
  assert.ok(!fs.existsSync(path.join(directory, 'SHA256SUMS.txt')))
})

test('rejects unexpected files rather than silently publishing them', async (t) => {
  const { root, directory } = fixture(t)
  fs.writeFileSync(path.join(directory, 'certificate.p12'), 'not an installer')
  await assert.rejects(prepareReleaseAssets(root, directory), /Expected exactly/)
})

test('rejects an empty installer', async (t) => {
  const { root, directory, assets } = fixture(t)
  fs.writeFileSync(path.join(directory, assets[0]), '')
  await assert.rejects(prepareReleaseAssets(root, directory), /empty or not a regular file/)
})

test('requires both update manifests and the Windows differential blockmap', async (t) => {
  for (const name of ['latest.yml', 'latest-linux.yml', 'Sorcerer-1.8.0-win-x64.exe.blockmap']) {
    const { root, directory } = fixture(t)
    fs.unlinkSync(path.join(directory, name))
    await assert.rejects(prepareReleaseAssets(root, directory), /Expected exactly/)
  }
})

test('rejects invalid YAML and duplicate manifest keys', async (t) => {
  for (const content of ['version: [unterminated', 'version: 1.8.0\nversion: 1.7.22\n']) {
    const { root, directory } = fixture(t)
    fs.writeFileSync(path.join(directory, 'latest.yml'), content)
    await assert.rejects(prepareReleaseAssets(root, directory), /Invalid update manifest/)
  }
})

test('rejects manifests from a different release for either managed platform', async (t) => {
  for (const name of ['latest.yml', 'latest-linux.yml']) {
    const { root, directory } = fixture(t)
    changeManifest(directory, name, (manifest) => { manifest.version = '1.7.22' })
    await assert.rejects(prepareReleaseAssets(root, directory), /version must equal/)
  }
})

test('rejects traversal, encoded names, external URLs, and cross-platform manifest references', async (t) => {
  for (const url of ['../Sorcerer-1.8.0-win-x64.exe', '%2e%2e/Sorcerer.exe', 'https://example.com/installer.exe', 'Sorcerer-1.8.0-mac-x64.dmg', 'C:\\installer.exe']) {
    const { root, directory } = fixture(t)
    changeManifest(directory, 'latest.yml', (manifest) => { manifest.files[0].url = url; manifest.path = url })
    await assert.rejects(prepareReleaseAssets(root, directory), /must reference only/)
  }
})

test('requires exactly one correct installer and disallows extra package downloads', async (t) => {
  for (const update of [
    (manifest) => { manifest.files = [] },
    (manifest) => { manifest.files.push({ ...manifest.files[0] }) },
    (manifest) => { manifest.packages = { x64: { path: 'payload.7z' } } }
  ]) {
    const { root, directory } = fixture(t)
    changeManifest(directory, 'latest.yml', update)
    await assert.rejects(prepareReleaseAssets(root, directory), /exactly one installer|additional packages/)
  }
})

test('checks manifest download sizes against the actual installer bytes', async (t) => {
  for (const size of [0, 1, '39', -1, 0.5]) {
    const { root, directory } = fixture(t)
    changeManifest(directory, 'latest-linux.yml', (manifest) => { manifest.files[0].size = size })
    await assert.rejects(prepareReleaseAssets(root, directory), /installer size does not match/)
  }
})

test('rejects a modified installer even if its size is unchanged', async (t) => {
  const { root, directory, assets } = fixture(t)
  const file = path.join(directory, assets[0])
  fs.writeFileSync(file, Buffer.alloc(fs.statSync(file).size, 'x'))
  await assert.rejects(prepareReleaseAssets(root, directory), /SHA512 does not match/)
})

test('checks both modern and legacy manifest digests and paths', async (t) => {
  for (const update of [
    (manifest) => { manifest.files[0].sha512 = 'invalid' },
    (manifest) => { manifest.sha512 = 'invalid' },
    (manifest) => { manifest.path = '../installer.exe' }
  ]) {
    const { root, directory } = fixture(t)
    changeManifest(directory, 'latest.yml', update)
    await assert.rejects(prepareReleaseAssets(root, directory), /SHA512 does not match|must reference only/)
  }
})
