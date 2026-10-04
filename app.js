/* 🔐 SUPABASE CONFIG */
const SUPABASE_URL = "https://chnjmdbmvjbnxxtllqwc.supabase.co"
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNobmptZGJtdmpibnh4dGxscXdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwODM2MTMsImV4cCI6MjA4NzY1OTYxM30.BYGzxR2q3sQGqPJnLLXv0z81JzSm6Ge0GgU-VYVQcRE"
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

/* GLOBALS */
let isAdmin = false
let currentImages = []
let currentDirName = ""
let currentIndex = 0

const compressionOptions = {
  maxWidthOrHeight: 1000,
  initialQuality: 0.25,
  fileType: "image/webp",
  useWebWorker: true
}

/* ELEMENTS */
const loginDiv = document.getElementById("login")
const appDiv = document.getElementById("app")
const adminPanel = document.getElementById("adminPanel")
const imageDirs = document.getElementById("imageDirs")
const pendingDirs = document.getElementById("pendingDirs")
const galleryModal = document.getElementById("galleryModal")
const galleryGrid = document.getElementById("galleryGrid")
const galleryTitle = document.getElementById("galleryTitle")

/* ===================== AUTH ===================== */

async function login() {
  const emailInput = document.getElementById("email").value
  const passwordInput = document.getElementById("password").value
  if (!emailInput || !passwordInput) { alert("Please enter email and password"); return }
  const { error } = await supabaseClient.auth.signInWithPassword({ email: emailInput, password: passwordInput })
  if (error) alert(error.message)
  else showApp()
}

async function logout() {
  await supabaseClient.auth.signOut()
  location.reload()
}

async function showApp() {
  loginDiv.style.display = "none"
  appDiv.style.display = "block"
  const { data } = await supabaseClient.auth.getUser()
  if (!data?.user) { location.reload(); return }
  isAdmin = data.user.email === "arduinodebugstick@outlook.com"
  loadImageDirs()
  loadTextSubmissions()
  if (isAdmin) {
    adminPanel.style.display = "block"
    loadPendingImageDirs()
    loadPendingTextSubmissions()
  }
}

/* ===================== IMAGE PROCESSING ===================== */

async function convertToGrayscale(file) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3
    data[i] = avg; data[i + 1] = avg; data[i + 2] = avg
  }
  ctx.putImageData(imageData, 0, 0)
  return new Promise(resolve => { canvas.toBlob(blob => resolve(blob), "image/webp", 0.4) })
}

/* ===================== ZIP HELPER ===================== */

async function ensureJSZip() {
  if (typeof JSZip !== 'undefined') return
  await new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    s.onload = res; s.onerror = rej
    document.head.appendChild(s)
  })
}

function isPdfPath(p) { return /\.pdf$/i.test(p || '') }

function safeName(s) { return s.replace(/[\/\\:*?"<>|]/g, '_') }

/* Download a single image blob by URL */
async function downloadSingleImage(signedUrl, filename) {
  const res = await fetch(signedUrl)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* Download multiple dirs as a single ZIP */
async function downloadDirsAsZip(dirs, zipName, progressCb) {
  await ensureJSZip()
  const zip = new JSZip()
  let total = 0, done = 0

  // Gather all image records
  const dirImageMap = []
  for (const dir of dirs) {
    const { data: images } = await supabaseClient
      .from('images').select('storage_path')
      .eq('directory_id', dir.id).eq('status', 'approved')
    const imgs = images || []
    total += imgs.length
    dirImageMap.push({ dir, imgs })
  }

  if (total === 0) return { count: 0 }

  for (const { dir, imgs } of dirImageMap) {
    const folder = zip.folder(safeName(dir.name))
    for (const img of imgs) {
      const { data: urlData } = await supabaseClient.storage
        .from('image_uploads').createSignedUrl(img.storage_path, 3600)
      if (urlData?.signedUrl) {
        try {
          const res = await fetch(urlData.signedUrl)
          const blob = await res.blob()
          folder.file(img.storage_path.split('/').pop() || `file_${done}${isPdfPath(img.storage_path) ? '.pdf' : '.webp'}`, blob)
        } catch(e) { /* skip */ }
      }
      done++
      if (progressCb) progressCb(done, total)
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = safeName(zipName) + '.zip'
  document.body.appendChild(a); a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return { count: total }
}

/* ===================== IMAGE UPLOAD ===================== */

async function uploadImageDirectoryCore(name, files, progressEl) {
  const user = (await supabaseClient.auth.getUser()).data.user
  const { data: dir, error: dirError } = await supabaseClient
    .from("image_directories").insert({ name, uploaded_by: user.id }).select().single()
  if (dirError) throw new Error(dirError.message)

  const total = files.length
  let done = 0
  for (const file of Array.from(files)) {
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name)
      let compressed, path, uploadOpts
      if (isPdf) {
        // PDFs are uploaded as-is (no grayscale / compression)
        compressed = file
        path = `${user.id}/${dir.id}/${crypto.randomUUID()}.pdf`
        uploadOpts = { contentType: "application/pdf" }
      } else {
        const grayBlob = await convertToGrayscale(file)
        compressed = await imageCompression(grayBlob, compressionOptions)
        path = `${user.id}/${dir.id}/${crypto.randomUUID()}.webp`
        uploadOpts = undefined
      }
      const { error: uploadError } = await supabaseClient.storage
        .from("image_uploads").upload(path, compressed, uploadOpts)
      if (uploadError) console.error(uploadError)
      if (!uploadError) {
        await supabaseClient.from("images").insert({
          directory_id: dir.id, uploaded_by: user.id,
          storage_path: path, filesize: compressed.size, status: "pending"
        })
      }
    } catch (err) { console.error(err) }
    done++
    if (progressEl) progressEl(done, total, file.name)
  }
  // Invalidate cache
  allDirsCache = null
  return dir
}

async function uploadImageDirectory() {
  const name = document.getElementById("dirName").value
  const files = document.getElementById("imageFiles").files
  if (!name || !files.length) { alert("Directory name and images are required"); return }

  const btn = document.getElementById("uploadBtn")
  const wrap = document.getElementById("uploadProgressWrap")
  const bar = document.getElementById("uploadProgressBar")
  const label = document.getElementById("uploadProgressLabel")
  const pct = document.getElementById("uploadProgressPct")

  btn.disabled = true
  wrap.style.display = "block"
  bar.style.width = "0%"

  try {
    await uploadImageDirectoryCore(name, files, (done, total, fname) => {
      label.textContent = `Uploading ${fname}…`
      const p = Math.round((done / total) * 100)
      bar.style.width = p + "%"
      pct.textContent = p + "%"
    })
    label.textContent = "Upload complete!"
    alert("Image directory submitted for review")
  } catch(e) { alert(e.message) }

  btn.disabled = false
  setTimeout(() => { wrap.style.display = "none" }, 3000)
}

/* ===================== DIRECTORY LIST ===================== */

async function loadImageDirs() {
  const q = document.getElementById("dirSearch").value
  let query = supabaseClient.from("image_directories").select("*")
    .eq("status", "approved").order("created_at", { ascending: false })
  if (q) query = query.ilike("name", `%${q}%`)
  const { data } = await query
  imageDirs.innerHTML = ""
  if (!data) return
  data.forEach(d => {
    const li = document.createElement("li")
    li.innerHTML = `
      <strong>${d.name}</strong><br><br>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button onclick="openDirectory('${d.id}','${escAttr(d.name)}')">Open Directory</button>
        <button class="secondary" onclick="downloadDirectory('${d.id}','${escAttr(d.name)}',this)">⬇ Download All</button>
      </div>
    `
    imageDirs.appendChild(li)
  })
}

function escAttr(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;') }

/* Download entire directory from the listing */
async function downloadDirectory(dirId, dirName, btn) {
  btn.disabled = true
  btn.textContent = '⏳ Preparing...'
  try {
    const { count } = await downloadDirsAsZip(
      [{ id: dirId, name: dirName }],
      dirName,
      (done, total) => { btn.textContent = `⏳ ${done}/${total}` }
    )
    btn.textContent = count > 0 ? '✓ Downloaded' : '⚠ No images'
  } catch(e) { btn.textContent = '✗ Error'; console.error(e) }
  setTimeout(() => { btn.disabled = false; btn.textContent = '⬇ Download All' }, 3000)
}

/* ===================== DIRECTORY VIEW (GALLERY) ===================== */

async function openDirectory(directoryId, dirName) {
  currentDirName = dirName || "Directory"
  galleryGrid.innerHTML = "<p style='color:var(--muted)'>Loading images...</p>"
  galleryModal.style.display = "block"
  galleryModal.scrollTop = 0

  if (!dirName) {
    const { data: dir } = await supabaseClient.from("image_directories")
      .select("name").eq("id", directoryId).single()
    currentDirName = dir ? dir.name : "Directory"
  }
  galleryTitle.textContent = currentDirName

  let imgQuery = supabaseClient.from("images").select("*")
    .eq("directory_id", directoryId).order("created_at", { ascending: true })
  if (!isAdmin) imgQuery = imgQuery.eq("status", "approved")
  const { data: images } = await imgQuery

  currentImages = images || []
  galleryGrid.innerHTML = ""

  if (!currentImages.length) {
    galleryGrid.innerHTML = "<p style='color:var(--muted)'>No files in this directory.</p>"
    return
  }

  // Header bar: image count + Download All button
  const header = document.createElement("div")
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;"
  header.innerHTML = `
    <span style="color:var(--muted);font-size:.9rem">${currentImages.length} file${currentImages.length !== 1 ? 's' : ''}</span>
    <button id="dlAllBtn" onclick="downloadDirectory('${directoryId}','${escAttr(currentDirName)}',this)" style="margin-top:0;padding:8px 14px;font-size:.85rem;">⬇ Download All</button>
  `
  galleryGrid.appendChild(header)

  const grid = document.createElement("div")
  grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;"
  galleryGrid.appendChild(grid)

  for (let index = 0; index < currentImages.length; index++) {
    const img = currentImages[index]
    const { data: urlData } = await supabaseClient.storage
      .from("image_uploads").createSignedUrl(img.storage_path, 3600)

    const div = document.createElement("div")
    div.style.cssText = "position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:#eee;"

    const signedUrl = urlData?.signedUrl || null
    const fname = img.storage_path.split('/').pop() || `image_${index + 1}.webp`

    if (signedUrl && isPdfPath(img.storage_path)) {
      div.innerHTML = `
        <div onclick="openImageViewer(${index})" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;aspect-ratio:1;cursor:pointer;background:#fff;color:#c0392b;">
          <span style="font-size:2.4rem;line-height:1;">📄</span>
          <span style="font-size:.7rem;font-weight:700;letter-spacing:.05em;">PDF</span>
        </div>
        <button onclick="event.stopPropagation();singleDownload('${signedUrl}','${fname.replace(/'/g, "")}',this)"
          style="position:absolute;bottom:6px;right:6px;margin:0;padding:5px 8px;font-size:.7rem;border-radius:6px;opacity:.9;line-height:1;">⬇</button>
      `
    } else if (signedUrl) {
      div.innerHTML = `
        <img src="${signedUrl}" style="width:100%;aspect-ratio:1;object-fit:cover;display:block;cursor:pointer;" loading="lazy" onclick="openImageViewer(${index})" />
        <button onclick="event.stopPropagation();singleDownload('${signedUrl}','${fname}',this)"
          style="position:absolute;bottom:6px;right:6px;margin:0;padding:5px 8px;font-size:.7rem;border-radius:6px;opacity:.9;line-height:1;">⬇</button>
      `
    } else {
      div.innerHTML = `
        <div onclick="openImageViewer(${index})" style="display:flex;align-items:center;justify-content:center;aspect-ratio:1;color:var(--muted);font-size:.8rem;cursor:pointer;">File ${index + 1}</div>
      `
    }
    grid.appendChild(div)
  }
}

async function singleDownload(signedUrl, filename, btn) {
  btn.disabled = true; btn.textContent = '⏳'
  try { await downloadSingleImage(signedUrl, filename); btn.textContent = '✓' }
  catch(e) { btn.textContent = '✗' }
  setTimeout(() => { btn.disabled = false; btn.textContent = '⬇' }, 2000)
}

/* ===================== FULLSCREEN VIEWER ===================== */

async function openImageViewer(index) {
  currentIndex = index
  document.getElementById("fileViewer").style.display = "block"
  loadViewerImage()
}

async function loadViewerImage() {
  const img = currentImages[currentIndex]
  if (!img) return
  const viewerImg = document.getElementById("viewerImage")
  const viewerPdf = document.getElementById("viewerPdf")
  const viewerPdfLink = document.getElementById("viewerPdfLink")
  const pdf = isPdfPath(img.storage_path)
  viewerImg.src = ""
  viewerPdf.src = "about:blank"
  viewerImg.style.display = pdf ? "none" : "block"
  viewerPdf.style.display = pdf ? "block" : "none"
  viewerPdfLink.style.display = pdf ? "block" : "none"
  const { data, error } = await supabaseClient.storage
    .from("image_uploads").createSignedUrl(img.storage_path, 3600)
  if (error || !data?.signedUrl) return
  if (pdf) { viewerPdf.src = data.signedUrl; viewerPdfLink.href = data.signedUrl }
  else viewerImg.src = data.signedUrl
}

function closeGallery() { document.getElementById("galleryModal").style.display = "none" }
function closeViewer()  { document.getElementById("fileViewer").style.display = "none"; document.getElementById("viewerPdf").src = "about:blank" }
function nextImage() { if (currentIndex < currentImages.length - 1) { currentIndex++; loadViewerImage() } }
function prevImage() { if (currentIndex > 0) { currentIndex--; loadViewerImage() } }

/* ===================== TEXT SUBMISSIONS ===================== */

async function submitWork() {
  const user = (await supabaseClient.auth.getUser()).data.user
  const date = document.getElementById("subDate").value
  const notebook = document.getElementById("subNotebook").value.trim()
  const title = document.getElementById("subTitle").value.trim()
  const content = document.getElementById("subContent").value.trim()
  if (!date || !notebook || !title || !content) return alert("All fields required")
  await supabaseClient.from("submissions").insert({
    date, notebook, title, content, submitted_by: user.id, status: "pending"
  })
  alert("Work submitted for review")
}

async function loadTextSubmissions() {
  const q = document.getElementById("textSearch")?.value || ""
  let query = supabaseClient.from("submissions").select("*")
    .eq("status", "approved").order("created_at", { ascending: false })
  if (q) query = query.or(`title.ilike.%${q}%,content.ilike.%${q}%`)
  const { data } = await query
  const list = document.getElementById("textList")
  if (!list) return
  list.innerHTML = ""
  if (!data) return
  data.forEach(sub => {
    const preview = sub.content.length > 200 ? sub.content.substring(0, 200) + "..." : sub.content
    const li = document.createElement("li")
    li.innerHTML = `<strong>${sub.title}</strong><br>
      <span class="muted">${sub.date} · ${sub.notebook}</span><br><br>${preview}`
    list.appendChild(li)
  })
}

/* ===================== ADMIN ===================== */

async function loadPendingImageDirs() {
  const { data } = await supabaseClient.from("image_directories").select("*").eq("status", "pending")
  pendingDirs.innerHTML = ""
  if (!data) return
  data.forEach(d => {
    const li = document.createElement("li")
    li.innerHTML = `<strong>${d.name}</strong><br><br>
      <button onclick="openDirectory('${d.id}','${escAttr(d.name)}')">View</button>
      <button onclick="approveDir('${d.id}')">Approve</button>
      <button class="secondary" onclick="rejectDir('${d.id}')">Reject</button>`
    pendingDirs.appendChild(li)
  })
}

async function loadPendingTextSubmissions() {
  const { data } = await supabaseClient.from("submissions").select("*").eq("status", "pending")
  let c = document.getElementById("pendingTextContainer")
  if (!c) { c = document.createElement("div"); c.id = "pendingTextContainer"; adminPanel.appendChild(c) }
  c.innerHTML = ""
  if (!data) return
  data.forEach(sub => {
    const div = document.createElement("div"); div.className = "card"
    div.innerHTML = `<strong>${sub.title}</strong><br>${sub.content}<br><br>
      <button onclick="approveText('${sub.id}')">Approve</button>
      <button class="secondary" onclick="rejectText('${sub.id}')">Reject</button>`
    c.appendChild(div)
  })
}

async function approveDir(id) {
  await supabaseClient.from("image_directories").update({ status: "approved" }).eq("id", id)
  await supabaseClient.from("images").update({ status: "approved" }).eq("directory_id", id)
  loadPendingImageDirs(); loadImageDirs()
}
async function rejectDir(id) {
  await supabaseClient.from("image_directories").update({ status: "rejected" }).eq("id", id)
  loadPendingImageDirs()
}
async function approveText(id) {
  await supabaseClient.from("submissions").update({ status: "approved" }).eq("id", id)
  await loadPendingTextSubmissions(); await loadTextSubmissions()
}
async function rejectText(id) {
  await supabaseClient.from("submissions").update({ status: "rejected" }).eq("id", id)
  await loadPendingTextSubmissions()
}

/* ===================== AUTO LOGIN ===================== */

supabaseClient.auth.getSession().then(({ data }) => { if (data.session) showApp() })

/* ===================== TAB SWITCHING ===================== */

function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('tab-' + name).classList.add('active')
  btn.classList.add('active')
  if (name === 'calendar') initCalendar()
  if (name === 'terminal') initTerminal()
}

/* ===================== CALENDAR ===================== */

let calYear, calMonth, calDirsByDate = {}

async function initCalendar() {
  if (calYear !== undefined) { renderCal(); return }
  const now = new Date()
  calYear = now.getFullYear(); calMonth = now.getMonth()
  await loadAllDirsForCalendar()
  renderCal()
}

async function loadAllDirsForCalendar() {
  const { data } = await supabaseClient.from('image_directories')
    .select('id, name').eq('status', 'approved')
  calDirsByDate = {}
  if (!data) return
  data.forEach(d => {
    const m = d.name.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (!m) return
    const key = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
    if (!calDirsByDate[key]) calDirsByDate[key] = []
    calDirsByDate[key].push(d)
  })
}

function calNav(dir) {
  calMonth += dir
  if (calMonth > 11) { calMonth = 0; calYear++ }
  if (calMonth < 0) { calMonth = 11; calYear-- }
  renderCal()
}

function renderCal() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  document.getElementById('calTitle').textContent = `${months[calMonth]} ${calYear}`
  const grid = document.getElementById('calGrid')
  grid.innerHTML = ''
  const dows = ['Su','Mo','Tu','We','Th','Fr','Sa']
  dows.forEach(d => {
    const el = document.createElement('div'); el.className = 'cal-dow'; el.textContent = d; grid.appendChild(el)
  })
  const firstDay = new Date(calYear, calMonth, 1).getDay()
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const today = new Date()
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div'); el.className = 'cal-day empty'; el.textContent = ' '; grid.appendChild(el)
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const el = document.createElement('div'); el.className = 'cal-day'; el.textContent = day
    const mm = String(calMonth + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    const key = `${calYear}-${mm}-${dd}`
    if (today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === day)
      el.classList.add('today')
    if (calDirsByDate[key]) {
      el.classList.add('has-entries')
      el.title = `${calDirsByDate[key].length} director${calDirsByDate[key].length > 1 ? 'ies' : 'y'}`
      el.onclick = () => showCalDate(key, day, el)
    }
    grid.appendChild(el)
  }
}

function showCalDate(key, day, el) {
  document.querySelectorAll('.cal-day.selected').forEach(e => e.classList.remove('selected'))
  el.classList.add('selected')
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const dirs = calDirsByDate[key] || []
  document.getElementById('calResultTitle').textContent =
    `${dirs.length} director${dirs.length !== 1 ? 'ies' : 'y'} on ${day} ${months[calMonth]} ${calYear}`
  const list = document.getElementById('calDirList')
  list.innerHTML = ''
  dirs.forEach(d => {
    const li = document.createElement('li')
    li.innerHTML = `<strong>${d.name}</strong><br><br>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button onclick="openDirectory('${d.id}','${escAttr(d.name)}')">Open Directory</button>
        <button class="secondary" onclick="downloadDirectory('${d.id}','${escAttr(d.name)}',this)" style="margin-top:0;">⬇ Download All</button>
      </div>`
    list.appendChild(li)
  })
}

/* ===================== TERMINAL ===================== */

let termInited = false
let termHistory = []
let termHistIdx = -1
let allDirsCache = null
// upload flow state
let termUploadState = null

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

async function initTerminal() {
  if (termInited) return
  termInited = true
  const input = document.getElementById('termInput')
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const cmd = input.value
      input.value = ''
      termHistIdx = -1
      if (cmd.trim()) { termHistory.unshift(cmd.trim()); await runTermCmd(cmd.trim()) }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (termHistIdx < termHistory.length - 1) { termHistIdx++; input.value = termHistory[termHistIdx] }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (termHistIdx > 0) { termHistIdx--; input.value = termHistory[termHistIdx] }
      else { termHistIdx = -1; input.value = '' }
    }
  })
  document.getElementById('termOutput').addEventListener('click', () => input.focus())
  termPrint('<span class="term-green">Curriculum Archive VFS Terminal v2</span>')
  termPrint('<span class="term-muted">Type <span class="term-cyan">help</span> for available commands.</span>')
  termPrint('')
  input.focus()
}

function termPrint(html) {
  const out = document.getElementById('termOutput')
  const line = document.createElement('div'); line.className = 'term-line'; line.innerHTML = html
  out.appendChild(line); out.scrollTop = out.scrollHeight
}

function termEcho(cmd) {
  termPrint(`<span class="term-prompt">archive:/$ </span><span>${escHtml(cmd)}</span>`)
}

async function runTermCmd(raw) {
  // If in upload flow, handle sub-prompts
  if (termUploadState) { await handleUploadFlow(raw); return }

  termEcho(raw)
  const cmd = raw.trim()
  const lower = cmd.toLowerCase()

  /* CLEAR */
  if (lower === 'clear') { document.getElementById('termOutput').innerHTML = ''; return }

  /* HELP */
  if (lower === 'help') {
    termPrint('<span class="term-yellow">━━━ Available Commands ━━━</span>')
    termPrint('')
    termPrint('  <span class="term-cyan">ls</span>')
    termPrint('    <span class="term-muted">List all approved directories</span>')
    termPrint('')
    termPrint('  <span class="term-cyan">download &lt;date1&gt; &lt;date2&gt; &lt;subject&gt;</span>')
    termPrint('    <span class="term-muted">Download all &lt;subject&gt; directories between date1 and date2 as a ZIP.</span>')
    termPrint('    <span class="term-muted">Dates in DD/MM/YYYY format. Use * for open-ended range.</span>')
    termPrint('    <span class="term-muted">Example: download 01/03/2026 31/03/2026 Maths</span>')
    termPrint('    <span class="term-muted">Example: download * * Physics   (all Physics, any date)</span>')
    termPrint('')
    termPrint('  <span class="term-cyan">upload &lt;date&gt; &lt;subject&gt; "&lt;topic&gt;"</span>')
    termPrint('    <span class="term-muted">Upload a new directory of images and/or PDFs. Prompts you to pick files.</span>')
    termPrint('    <span class="term-muted">Example: upload 07/04/2026 Physics "Optics"</span>')
    termPrint('')
    termPrint('  <span class="term-cyan">clear</span>  <span class="term-muted">Clear the terminal</span>')
    termPrint('  <span class="term-cyan">help</span>   <span class="term-muted">Show this help</span>')
    termPrint('')
    return
  }

  /* LS */
  if (lower === 'ls') {
    termPrint('<span class="term-muted">Fetching directories…</span>')
    const dirs = await fetchAllDirs()
    const prev = document.getElementById('termOutput').lastChild; if (prev) prev.remove()
    if (!dirs.length) { termPrint('<span class="term-muted">No directories found.</span>'); return }
    termPrint(`<span class="term-muted">total ${dirs.length}</span>`)
    dirs.forEach(d => { termPrint(`  <span class="term-dir">📁 ${escHtml(d.name)}</span>`) })
    termPrint('')
    return
  }

  /* DOWNLOAD date1 date2 subject */
  if (lower.startsWith('download')) {
    // Parse: download <date1> <date2> <subject...>
    // date can be DD/MM/YYYY or *
    const rest = cmd.slice(8).trim()
    if (!rest) {
      termPrint('<span class="term-red">Usage: download &lt;date1&gt; &lt;date2&gt; &lt;subject&gt;</span>')
      termPrint('<span class="term-muted">Dates in DD/MM/YYYY. Use * for open-ended. E.g.: download 01/03/2026 31/03/2026 Maths</span>')
      return
    }

    // Tokenise respecting DD/MM/YYYY as single tokens
    const tokens = rest.match(/(\d{1,2}\/\d{1,2}\/\d{4}|\*|\S+)/g) || []
    if (tokens.length < 3) {
      termPrint('<span class="term-red">Need: download &lt;date1&gt; &lt;date2&gt; &lt;subject&gt;</span>')
      return
    }

    const rawDate1 = tokens[0]
    const rawDate2 = tokens[1]
    const subject = tokens.slice(2).join(' ')

    const parseDate = (s) => {
      if (s === '*') return null
      const parts = s.split('/')
      if (parts.length !== 3) return undefined
      const [d, mo, y] = parts.map(Number)
      const dt = new Date(y, mo - 1, d)
      return isNaN(dt) ? undefined : dt
    }

    const d1 = parseDate(rawDate1)
    const d2 = parseDate(rawDate2)
    if (d1 === undefined || d2 === undefined) {
      termPrint('<span class="term-red">Invalid date format. Use DD/MM/YYYY or * for any date.</span>')
      return
    }

    termPrint(`<span class="term-muted">Searching: subject="${escHtml(subject)}" from ${escHtml(rawDate1)} to ${escHtml(rawDate2)}…</span>`)
    const allDirs = await fetchAllDirs()

    const matched = allDirs.filter(dir => {
      const m = dir.name.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\S+)/)
      if (!m) return false
      const dirSubject = m[4]
      if (dirSubject.toLowerCase() !== subject.toLowerCase()) return false
      const dirDate = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
      if (d1 && dirDate < d1) return false
      if (d2 && dirDate > d2) return false
      return true
    })

    if (!matched.length) {
      termPrint(`<span class="term-red">No directories matched subject "${escHtml(subject)}" in that date range.</span>`)
      return
    }

    termPrint(`<span class="term-green">Found ${matched.length} director${matched.length !== 1 ? 'ies' : 'y'}:</span>`)
    matched.forEach(d => termPrint(`  <span class="term-dir">📁 ${escHtml(d.name)}</span>`))
    termPrint('<span class="term-yellow">Building ZIP…</span>')

    const zipName = `${subject}_${rawDate1.replace(/\//g,'-')}_to_${rawDate2.replace(/\//g,'-')}`
    let lastPct = -1
    const { count } = await downloadDirsAsZip(matched, zipName, (done, total) => {
      const pct = Math.round((done / total) * 100)
      if (pct !== lastPct && pct % 10 === 0) {
        termPrint(`  <span class="term-muted">[${pct}%] ${done}/${total} images fetched</span>`)
        lastPct = pct
      }
    })

    if (count === 0) { termPrint('<span class="term-red">No approved images found in matched directories.</span>'); return }
    termPrint(`<span class="term-green">✓ Download started: ${escHtml(zipName)}.zip (${count} images)</span>`)
    termPrint('')
    return
  }

  /* UPLOAD date subject "topic" */
  if (lower.startsWith('upload')) {
    const rest = cmd.slice(6).trim()
    if (!rest) {
      termPrint('<span class="term-red">Usage: upload &lt;date&gt; &lt;subject&gt; "&lt;topic&gt;"</span>')
      termPrint('<span class="term-muted">Example: upload 07/04/2026 Physics "Optics"</span>')
      return
    }

    // Parse date, subject, topic
    const dateMatch = rest.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+/)
    if (!dateMatch) { termPrint('<span class="term-red">Date must be first in DD/MM/YYYY format.</span>'); return }
    const date = dateMatch[1]
    const after = rest.slice(dateMatch[0].length).trim()

    // subject is next word, topic is quoted or rest
    const subjMatch = after.match(/^(\S+)\s+(.+)$/)
    if (!subjMatch) { termPrint('<span class="term-red">Need subject and topic. E.g.: upload 07/04/2026 Physics "Optics"</span>'); return }
    const subject = subjMatch[1]
    const topic = subjMatch[2].replace(/^["']|["']$/g, '')

    const dirName = `${date} ${subject} ${topic}`
    termPrint(`<span class="term-green">New directory:</span> <span class="term-dir">${escHtml(dirName)}</span>`)
    termPrint('<span class="term-muted">Please select your image or PDF files when the file picker opens…</span>')

    // Trigger file picker
    termUploadState = { dirName, step: 'awaiting_files' }
    const fileInput = document.createElement('input')
    fileInput.type = 'file'; fileInput.multiple = true; fileInput.accept = 'image/*,application/pdf,.pdf'
    fileInput.style.display = 'none'
    document.body.appendChild(fileInput)

    fileInput.addEventListener('change', async () => {
      document.body.removeChild(fileInput)
      const files = fileInput.files
      if (!files || files.length === 0) {
        termPrint('<span class="term-red">No files selected. Upload cancelled.</span>')
        termUploadState = null; return
      }
      termPrint(`<span class="term-muted">${files.length} file${files.length !== 1 ? 's' : ''} selected. Uploading…</span>`)
      let lastPct = -1
      try {
        await uploadImageDirectoryCore(termUploadState.dirName, files, (done, total, fname) => {
          const pct = Math.round((done / total) * 100)
          if (pct !== lastPct) {
            termPrint(`  <span class="term-muted">[${pct}%] Processing ${escHtml(fname)}…</span>`)
            lastPct = pct
          }
        })
        termPrint(`<span class="term-green">✓ Upload complete! "${escHtml(termUploadState.dirName)}" submitted for review.</span>`)
      } catch(e) {
        termPrint(`<span class="term-red">Upload failed: ${escHtml(e.message)}</span>`)
      }
      termUploadState = null
      termPrint('')
    })

    fileInput.addEventListener('cancel', () => {
      document.body.removeChild(fileInput)
      termPrint('<span class="term-red">File selection cancelled.</span>')
      termUploadState = null
    })

    fileInput.click()
    return
  }

  termPrint(`<span class="term-red">Command not found:</span> ${escHtml(cmd.split(' ')[0])} — type <span class="term-cyan">help</span>`)
}

async function handleUploadFlow(input) {
  // placeholder — all upload interaction is now file-picker based
  termPrint('<span class="term-muted">Waiting for file picker…</span>')
}

async function fetchAllDirs(force) {
  if (!force && allDirsCache) return allDirsCache
  const { data } = await supabaseClient
    .from('image_directories').select('id, name')
    .eq('status', 'approved').order('created_at', { ascending: false })
  allDirsCache = data || []
  return allDirsCache
}
