const fs = require('node:fs')
const path = require('node:path')

function validateRelease(root, tag) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) {
    throw new Error('Desktop releases require a stable MAJOR.MINOR.PATCH version')
  }
  const expectedTag = `v${pkg.version}`
  if (tag !== undefined && tag !== expectedTag) {
    throw new Error(`Release tag ${tag} does not match package version ${expectedTag}`)
  }
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error('package.json and both package-lock.json version fields must match')
  }
  const notesPath = `docs/releases/${expectedTag}.md`
  const notes = fs.readFileSync(path.join(root, notesPath), 'utf8').replace(/\r\n/g, '\n')
  if (!notes.startsWith(`# Sorcerer ${expectedTag}\n`)) {
    throw new Error(`Release notes must start with # Sorcerer ${expectedTag}`)
  }
  const date = notes.match(/^Released: (\d{4}-\d{2}-\d{2})$/m)?.[1]
  if (!date || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error('Release notes require a valid Released: YYYY-MM-DD date')
  }
  for (const title of ['Highlights', 'Fixes and polish', 'Notes']) {
    const section = notes.match(new RegExp(`^## ${title}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))
    if (!section || !section[1].trim()) {
      throw new Error(`Release notes require a nonempty ## ${title} section`)
    }
  }
  if (/\b(?:TODO|TBD)\b|\[Add |YYYY-MM-DD/.test(notes)) {
    throw new Error('Release notes still contain template placeholders')
  }
  return { version: pkg.version, tag: expectedTag, notesPath }
}

if (require.main === module) {
  try {
    const result = validateRelease(process.cwd(), process.argv[2])
    console.log(`Release metadata validated: ${result.tag} (${result.notesPath})`)
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\ntag=${result.tag}\nnotes=${result.notesPath}\n`)
    }
  } catch (error) {
    console.error(`Release validation failed: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { validateRelease }
