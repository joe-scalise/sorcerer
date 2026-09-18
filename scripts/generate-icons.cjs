// Rebuild desktop icon assets from the same vector mark used by the app bar.
// Uses the existing Electron dependency; no external graphics tools required.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const build = path.join(root, 'build')

if (process.argv[2] !== '--render') {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sorcerer-icon-render-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const result = spawnSync(require('electron'), [__filename, '--render', profile], {
      env, windowsHide: true, stdio: 'inherit', timeout: 30000
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Icon rendering failed (${result.status})`)
  } finally {
    assert.equal(path.dirname(profile), os.tmpdir())
    assert(path.basename(profile).startsWith('sorcerer-icon-render-'))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
} else {
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', process.argv[3])
  const deadline = setTimeout(() => app.exit(1), 25000)
  app.whenReady().then(async () => {
    const mark = fs.readFileSync(path.join(build, 'mark.svg'), 'utf8')
    const artwork = mark.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="1024" height="1024">
  <rect width="20" height="20" rx="4" fill="#171511"/>
  <g transform="translate(2 2)" fill="#e2a445">
${artwork.trim()}
  </g>
</svg>
`
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    await window.loadURL('data:text/html,<html><body></body></html>')
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
    const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    const images = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify(source)}; await image.decode();
      return ${JSON.stringify(sizes)}.map(size => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      });
    })()`)
    const pngs = images.map(image => Buffer.from(image, 'base64'))
    const entries = sizes.filter(size => size <= 256)
    const header = Buffer.alloc(6 + entries.length * 16)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(entries.length, 4)
    let offset = header.length
    entries.forEach((size, index) => {
      const entry = 6 + index * 16
      header[entry] = header[entry + 1] = size === 256 ? 0 : size
      header.writeUInt16LE(1, entry + 4)
      header.writeUInt16LE(32, entry + 6)
      header.writeUInt32LE(pngs[index].length, entry + 8)
      header.writeUInt32LE(offset, entry + 12)
      offset += pngs[index].length
    })
    fs.writeFileSync(path.join(build, 'icon.svg'), svg)
    fs.writeFileSync(path.join(build, 'icon.png'), pngs[sizes.indexOf(512)])
    fs.writeFileSync(path.join(build, 'icon-1024.png'), pngs[sizes.indexOf(1024)])
    fs.writeFileSync(path.join(build, 'icon.ico'), Buffer.concat([header, ...pngs.slice(0, entries.length)]))
    console.log(`Generated SVG, 512/1024px PNGs, and Windows ICO (${entries.join(', ')}px) from build/mark.svg`)
    clearTimeout(deadline)
    app.quit()
  }).catch(error => { console.error(error); app.exit(1) })
}
