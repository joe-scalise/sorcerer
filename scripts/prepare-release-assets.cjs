const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const YAML = require('yaml')
const { validateRelease } = require('./validate-release.cjs')

function validateUpdateManifest(directory, name, installer, version, artifacts) {
  const text = fs.readFileSync(path.join(directory, name), 'utf8')
  const document = YAML.parseDocument(text, { uniqueKeys: true })
  if (document.errors.length) throw new Error(`Invalid update manifest ${name}: ${document.errors[0].message}`)
  const manifest = document.toJS({ maxAliasCount: 0 })
  if (!manifest || manifest.version !== version) throw new Error(`Update manifest ${name} version must equal ${version}`)
  if (!Array.isArray(manifest.files) || manifest.files.length !== 1) {
    throw new Error(`Update manifest ${name} must reference exactly one installer`)
  }
  const entry = manifest.files[0]
  // Exact filenames also disallow external URLs, encoding, traversal, and
  // references to another platform's installer. Never resolve manifest paths.
  if (!entry || entry.url !== installer || manifest.path !== installer) {
    throw new Error(`Update manifest ${name} must reference only ${installer}`)
  }
  if (manifest.packages !== undefined) throw new Error(`Update manifest ${name} must not reference additional packages`)
  const artifact = artifacts.get(installer)
  if (!Number.isSafeInteger(entry.size) || entry.size !== artifact.size) {
    throw new Error(`Update manifest ${name} installer size does not match ${installer}`)
  }
  if (entry.sha512 !== artifact.sha512 || manifest.sha512 !== artifact.sha512) {
    throw new Error(`Update manifest ${name} SHA512 does not match ${installer}`)
  }
}

async function prepareReleaseAssets(root, directory) {
  const { version } = validateRelease(root)
  const windowsInstaller = `Sorcerer-${version}-win-x64.exe`
  const linuxInstaller = `Sorcerer-${version}-linux-x86_64.AppImage`
  const expected = [
    windowsInstaller,
    `${windowsInstaller}.blockmap`,
    `Sorcerer-${version}-mac-arm64.dmg`,
    `Sorcerer-${version}-mac-x64.dmg`,
    linuxInstaller,
    'latest.yml',
    'latest-linux.yml'
  ].sort()
  const actual = fs.readdirSync(directory).filter((name) => name !== 'SHA256SUMS.txt').sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected exactly these release assets: ${expected.join(', ')}; found: ${actual.join(', ')}`)
  }
  const sums = []
  const artifacts = new Map()
  for (const name of expected) {
    const file = path.join(directory, name)
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.size === 0) throw new Error(`Release asset is empty or not a regular file: ${name}`)
    const hash = crypto.createHash('sha256')
    const updateHash = crypto.createHash('sha512')
    for await (const chunk of fs.createReadStream(file)) {
      hash.update(chunk)
      updateHash.update(chunk)
    }
    sums.push(`${hash.digest('hex')}  ${name}`)
    artifacts.set(name, { size: stat.size, sha512: updateHash.digest('base64') })
  }
  validateUpdateManifest(directory, 'latest.yml', windowsInstaller, version, artifacts)
  validateUpdateManifest(directory, 'latest-linux.yml', linuxInstaller, version, artifacts)
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`)
  return expected
}

if (require.main === module) {
  prepareReleaseAssets(process.cwd(), process.argv[2] || 'artifacts').then((names) => {
    console.log(`Verified ${names.length} release assets, including updater metadata, and generated SHA256SUMS.txt`)
  }).catch((error) => {
    console.error(`Release assets validation failed: ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { prepareReleaseAssets }
