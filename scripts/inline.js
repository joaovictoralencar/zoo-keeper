#!/usr/bin/env node
/**
 * scripts/inline.js
 *
 * Produces dist/standalone.html — a single self-contained file with all JS
 * bundles and assets (base64 data URIs) inlined. The dist/ folder is never
 * modified; standalone.html is purely additive output.
 *
 * Usage:
 *   npm run build && npm run bundle
 *   → open dist/standalone.html directly in a browser, no server needed
 */

const fs   = require('fs')
const path = require('path')

const DIST   = path.resolve(__dirname, '../dist')
const OUTPUT = path.join(DIST, 'standalone.html')

const MIME = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.glb':  'model/gltf-binary',
  '.json': 'application/json',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.wav':  'audio/wav',
}

function walk(dir, base = dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(full, base))
    else out.push(path.relative(base, full).replace(/\\/g, '/'))
  }
  return out
}

/**
 * For GLB files that reference external textures (e.g. "Textures/colormap.png"),
 * bake those textures into the GLTF JSON chunk as data URIs so the file becomes
 * fully self-contained. Returns a Buffer (possibly modified).
 */
function processGlb(glbPath) {
  const glb = fs.readFileSync(glbPath)

  // GLB layout: 12-byte header | 8-byte chunk0 header | chunk0 data | ...
  const jsonChunkLen = glb.readUInt32LE(12)
  const jsonStart    = 20                       // 12 header + 8 chunk header
  const jsonStr      = glb.slice(jsonStart, jsonStart + jsonChunkLen)
                          .toString('utf8').replace(/\0+$/, '') // strip padding NULs

  let gltf
  try { gltf = JSON.parse(jsonStr) } catch { return glb }

  if (!gltf.images || gltf.images.length === 0) return glb

  const glbDir = path.dirname(glbPath)
  let modified = false

  for (const image of gltf.images) {
    if (!image.uri || image.uri.startsWith('data:') || image.bufferView != null) continue
    const texPath = path.join(glbDir, image.uri)
    if (!fs.existsSync(texPath)) { console.warn('  ⚠  Missing texture: ' + texPath); continue }
    const ext  = path.extname(texPath).toLowerCase()
    const mime = MIME[ext] || 'image/png'
    image.uri  = `data:${mime};base64,` + fs.readFileSync(texPath).toString('base64')
    modified   = true
  }

  if (!modified) return glb

  // Re-serialise JSON, pad to 4-byte boundary with spaces (per GLB spec)
  const newJsonStr = JSON.stringify(gltf)
  const paddedLen  = Math.ceil(newJsonStr.length / 4) * 4
  const newJsonBuf = Buffer.alloc(paddedLen, 0x20)
  Buffer.from(newJsonStr, 'utf8').copy(newJsonBuf)

  // Preserve any BIN chunk that follows the JSON chunk
  const binStart = jsonStart + jsonChunkLen
  const binPart  = glb.length > binStart ? glb.slice(binStart) : Buffer.alloc(0)

  const newTotal = 12 + 8 + paddedLen + binPart.length
  const out = Buffer.allocUnsafe(newTotal)
  glb.copy(out, 0, 0, 8)               // magic + version
  out.writeUInt32LE(newTotal, 8)        // total file length
  out.writeUInt32LE(paddedLen, 12)      // JSON chunk length
  glb.copy(out, 16, 16, 20)            // chunk type "JSON"
  newJsonBuf.copy(out, 20)             // new JSON data
  if (binPart.length > 0) binPart.copy(out, 20 + paddedLen)

  return out
}

function toDataUri(fullPath) {
  const ext  = path.extname(fullPath).toLowerCase()
  const mime = MIME[ext]
  if (!mime || !fs.existsSync(fullPath)) return null
  const data = ext === '.glb' ? processGlb(fullPath) : fs.readFileSync(fullPath)
  return `data:${mime};base64,` + data.toString('base64')
}

const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.wav'])
const GLB_EXTS   = new Set(['.glb'])

/**
 * Builds a unified XHR + fetch shim for binary assets (audio + GLBs).
 *
 * Audio (Phaser WebAudio): uses XMLHttpRequest with a relative path.
 *   → XHR shim matches by exact key.
 *
 * GLBs (Three.js FileLoader): uses fetch() with a Request object whose
 *   .url property is the already-resolved absolute file:/// URL.
 *   Chrome blocks that request with a CORS error before it reaches the
 *   network, so we must intercept before fetch() is called and return a
 *   synthetic Response from the shimMap data.
 *   → fetch shim matches by suffix ('/'+key) to handle both relative and
 *     absolute URL forms.
 *
 * Phaser 3.88+ reads e.target inside its XHR onload handler, so we pass
 * { target: self } to satisfy that lookup.
 */
function buildBinaryShim(shimMap) {
  if (Object.keys(shimMap).length === 0) return ''
  const json = JSON.stringify(shimMap)
  return `(function(){var __ad=${json};var _f=window.fetch,_o=XMLHttpRequest.prototype.open,_s=XMLHttpRequest.prototype.send;window.fetch=function(u,o){var url=typeof u==='string'?u:(u instanceof Request?u.url:String(u));var mk=null;for(var k in __ad){if(url===k||url.endsWith('/'+k)){mk=k;break;}}if(mk){var b64=__ad[mk];var raw=atob(b64);var buf=new ArrayBuffer(raw.length);var v=new Uint8Array(buf);for(var i=0;i<raw.length;i++)v[i]=raw.charCodeAt(i);return Promise.resolve(new Response(buf,{status:200,headers:{'Content-Type':'application/octet-stream'}}));}return _f.apply(this,arguments);};XMLHttpRequest.prototype.open=function(m,u){this.__au=(__ad[u]!==undefined?u:null);return _o.apply(this,arguments);};XMLHttpRequest.prototype.send=function(){var self=this;if(self.__au){var b64=__ad[self.__au];var raw=atob(b64);var buf=new ArrayBuffer(raw.length);var v=new Uint8Array(buf);for(var i=0;i<raw.length;i++)v[i]=raw.charCodeAt(i);setTimeout(function(){Object.defineProperty(self,'readyState',{get:function(){return 4},configurable:true});Object.defineProperty(self,'status',{get:function(){return 200},configurable:true});Object.defineProperty(self,'response',{get:function(){return buf},configurable:true});if(self.onreadystatechange)self.onreadystatechange({target:self,type:'readystatechange'});if(self.onload)self.onload({target:self,type:'load'});},0);return;}return _s.apply(this,arguments);};})();`
}

console.log('📦  Building standalone.html...\n')

// ── 1. Read dist/index.html ───────────────────────────────────────────────
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')

// ── 2. Collect all <script src="*.js"> tags in order ─────────────────────
const scriptRe = /<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g
const bundles  = []
let m
while ((m = scriptRe.exec(html)) !== null) bundles.push({ tag: m[0], src: m[1] })

if (bundles.length === 0) {
  console.error('❌  No <script src> tags found in index.html')
  process.exit(1)
}
console.log(`Found ${bundles.length} JS bundle(s): ${bundles.map(b => b.src).join(', ')}\n`)

// ── 3. Load and concatenate JS bundles ───────────────────────────────────
let js = bundles
  .map(b => {
    const p = path.join(DIST, b.src)
    if (!fs.existsSync(p)) { console.warn('  ⚠  Missing bundle: ' + p); return '' }
    return fs.readFileSync(p, 'utf8')
  })
  .join('\n')

let inlined = 0

// Unified shim map — populated by steps 4 and 5, consumed in step 6.
// Keys are the original relative asset paths (e.g. "assets/audios/bgm.mp3",
// "assets/env/graveyard/pine.glb").  Values are base64-encoded binary data.
// Each unique asset is stored exactly once regardless of how many times it
// is referenced in level.json or the JS bundles.
const shimMap = {}

// ── 4. Pre-process level.json ─────────────────────────────────────────────
// Small assets (icons/images) referenced in level.json are loaded by Phaser's
// image loader via <img> src, so they must be data URIs.  GLBs are loaded by
// Three.js via XHR — they go through the binary shim instead, keeping the
// original path in the JSON.  This avoids double-base64-encoding every prop
// model (e.g. pine.glb would otherwise be embedded 8 times).
const levelJsonDisk = path.join(DIST, 'assets', 'level.json')
if (fs.existsSync(levelJsonDisk)) {
  let levelJson = fs.readFileSync(levelJsonDisk, 'utf8')

  levelJson = levelJson.replace(/"(assets\/[^"]+)"/g, (match, assetPath) => {
    const ext      = path.extname(assetPath).toLowerCase()
    const fullPath = path.join(DIST, assetPath)

    if (GLB_EXTS.has(ext)) {
      // Store each unique GLB once in the shim; keep the original path in JSON
      if (!shimMap[assetPath]) {
        if (!fs.existsSync(fullPath)) { console.warn('  ⚠  Missing GLB: ' + assetPath); return match }
        const data = processGlb(fullPath)
        shimMap[assetPath] = data.toString('base64')
        const kb = (data.length / 1024).toFixed(1)
        console.log('  ▲  ' + assetPath + '  (' + kb + ' KB)  [GLB shim]')
        inlined++
      }
      return match // keep path as-is so Three.js XHR request matches shim key
    }

    // Small assets (PNG icons, etc.) — embed directly as data URI in JSON
    const uri = toDataUri(fullPath)
    if (!uri) return match
    const kb = (uri.length * 0.75 / 1024).toFixed(1)
    console.log('  ✓  ' + assetPath + '  (' + kb + ' KB)  [via level.json]')
    inlined++
    return '"' + uri + '"'
  })

  const modB64   = Buffer.from(levelJson).toString('base64')
  const levelUri = 'data:application/json;base64,' + modB64
  js = js.split('assets/level.json').join(levelUri)
  console.log('  ✓  assets/level.json  (icons embedded; GLBs via shim)')
  inlined++
}

// ── 5. Inline remaining assets referenced directly in the JS bundles ──────
const assetDir  = path.join(DIST, 'assets')
const allAssets = fs.existsSync(assetDir) ? walk(assetDir) : []

for (const rel of allAssets) {
  const ext       = path.extname(rel).toLowerCase()
  const assetPath = 'assets/' + rel
  if (!js.includes(assetPath)) continue

  if (AUDIO_EXTS.has(ext)) {
    const fullPath = path.join(assetDir, rel)
    shimMap[assetPath] = fs.readFileSync(fullPath).toString('base64')
    const kb = (fs.statSync(fullPath).size / 1024).toFixed(1)
    console.log('  ♪  ' + assetPath + '  (' + kb + ' KB)  [audio shim]')
    inlined++
    continue
  }

  if (GLB_EXTS.has(ext)) {
    // May already be in shimMap from the level.json step; don't double-add
    if (!shimMap[assetPath]) {
      const data = processGlb(path.join(assetDir, rel))
      shimMap[assetPath] = data.toString('base64')
      const kb = (data.length / 1024).toFixed(1)
      console.log('  ▲  ' + assetPath + '  (' + kb + ' KB)  [GLB shim, direct ref]')
      inlined++
    }
    continue // path stays as-is in JS; shim handles the XHR request
  }

  const uri = toDataUri(path.join(assetDir, rel))
  if (!uri) continue

  js = js.split(assetPath).join(uri)
  const kb = (uri.length * 0.75 / 1024).toFixed(1)
  console.log('  ✓  ' + assetPath + '  (' + kb + ' KB)')
  inlined++
}

console.log('\nInlined ' + inlined + ' asset(s).')

// Escape </  inside the JS so the HTML parser never mis-treats string
// literals like "</body>" (from Three.js SVG renderer) as real close-tags.
js = js.replace(/<\//g, '<\\/')

// ── 6. Build the standalone HTML ──────────────────────────────────────────
const binaryShim = buildBinaryShim(shimMap)

let out = html
for (const b of bundles) out = out.replace(b.tag, '')
// Use the last </body> to be safe, and place script right before it.
const bodyCloseIdx = out.lastIndexOf('</body>')
if (bodyCloseIdx === -1) {
  console.error('❌  Could not find </body> in index.html')
  process.exit(1)
}
out = out.slice(0, bodyCloseIdx) + '<script>\n' + (binaryShim ? binaryShim + '\n' : '') + js + '\n</script>\n</body>' + out.slice(bodyCloseIdx + '</body>'.length)

// ── 7. Write output ───────────────────────────────────────────────────────
fs.writeFileSync(OUTPUT, out, 'utf8')
const mb = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2)
console.log('\n✅  dist/standalone.html  (' + mb + ' MB)')
console.log('    Open it directly in a browser — no server required.\n')
