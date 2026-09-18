const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
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
  const assets = ['Sorcerer-1.8.0-win-x64.exe', 'Sorcerer-1.8.0-mac-arm64.dmg', 'Sorcerer-1.8.0-mac-x64.dmg', 'Sorcerer-1.8.0-linux-x64.AppImage']
  for (const name of assets) fs.writeFileSync(path.join(directory, name), `fixture: ${name}`)
  return { root, notes, directory, assets }
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

test('produces deterministic checksums for all four installers and permits reruns', async (t) => {
  const { root, directory, assets } = fixture(t)
  assert.deepEqual(await prepareReleaseAssets(root, directory), [...assets].sort())
  const sums = fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8')
  for (const name of assets) {
    const hash = crypto.createHash('sha256').update(`fixture: ${name}`).digest('hex')
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
