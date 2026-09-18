const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { validateRelease } = require('./validate-release.cjs')

async function prepareReleaseAssets(root, directory) {
  const { version } = validateRelease(root)
  const expected = [
    `Sorcerer-${version}-win-x64.exe`,
    `Sorcerer-${version}-mac-arm64.dmg`,
    `Sorcerer-${version}-mac-x64.dmg`,
    `Sorcerer-${version}-linux-x86_64.AppImage`
  ].sort()
  const actual = fs.readdirSync(directory).filter((name) => name !== 'SHA256SUMS.txt').sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected exactly these release installers: ${expected.join(', ')}; found: ${actual.join(', ')}`)
  }
  const sums = []
  for (const name of expected) {
    const file = path.join(directory, name)
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.size === 0) throw new Error(`Release installer is empty or not a regular file: ${name}`)
    const hash = crypto.createHash('sha256')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
    sums.push(`${hash.digest('hex')}  ${name}`)
  }
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`)
  return expected
}

if (require.main === module) {
  prepareReleaseAssets(process.cwd(), process.argv[2] || 'artifacts').then((names) => {
    console.log(`Verified ${names.length} installers and generated SHA256SUMS.txt`)
  }).catch((error) => {
    console.error(`Release assets validation failed: ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { prepareReleaseAssets }
