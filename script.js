const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const pickBtn = document.getElementById('pickBtn');
const presetSelect = document.getElementById('presetSelect');
const qualityEl = document.getElementById('quality');
const qualityVal = document.getElementById('qualityVal');
const processBtn = document.getElementById('processBtn');
const resetBtn = document.getElementById('resetBtn');
const cards = document.getElementById('cards');
const downloadZip = document.getElementById('downloadZip');
const batchProgress = document.getElementById('batchProgress');
const sizeSummary = document.getElementById('sizeSummary');
const useServer = document.getElementById('useServer');
const modeToggle = document.getElementById('modeToggle');
const modeLabel = document.getElementById('modeLabel');

let images = [];
let processedResults = [];

qualityEl.addEventListener('input', ()=> qualityVal.textContent = qualityEl.value);
pickBtn.addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', e => handleFiles(e.target.files));

['dragenter','dragover','dragleave','drop'].forEach(evt=>{
  dropZone.addEventListener(evt, ev => ev.preventDefault());
});
dropZone.addEventListener('drop', (e)=>{
  const dt = e.dataTransfer;
  handleFiles(dt.files);
});

function handleFiles(fileList){
  const arr = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  arr.forEach(f => {
    const url = URL.createObjectURL(f);
    images.push({file: f, url, originalSize: f.size, name: f.name});
  });
  renderCards();
  updateSummary();
}

function renderCards(){
  cards.innerHTML = '';
  images.forEach((img, i) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <img src="${img.url}" alt="${img.name}" />
      <div class="meta">
        <div>${img.name}</div>
        <div>${formatBytes(img.originalSize)}</div>
      </div>
      <div class="row">
        <button data-i="${i}" class="remove">Remove</button>
        <button data-i="${i}" class="process-single">Process</button>
      </div>
    `;
    cards.appendChild(el);
  });
  document.querySelectorAll('.remove').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const i = +e.target.dataset.i;
      URL.revokeObjectURL(images[i].url);
      images.splice(i,1);
      renderCards(); updateSummary();
    });
  });
  document.querySelectorAll('.process-single').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      const i = +e.target.dataset.i;
      await processOne(i);
    });
  });
}

function updateSummary(){
  if(images.length===0){
    sizeSummary.textContent = 'No images yet';
    downloadZip.disabled = true;
    batchProgress.value = 0;
    return;
  }
  const total = images.reduce((s,i)=>s+i.originalSize,0);
  sizeSummary.textContent = `${images.length} images — Total ${formatBytes(total)}`;
  downloadZip.disabled = false;
}

async function processOne(index){
  const imgObj = images[index];
  setProgress(0);
  const {width, height} = getDimsFromPreset();
  const q = +qualityEl.value;
  if(useServer.checked){

    const b64 = await fileToBase64(imgObj.file);
    const res = await fetch('/api/optimize', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({images:[{name: imgObj.name, data: b64}], width, height, quality: q})
    });
    const j = await res.json();
  
    const out = j.results[0];
    const blob = base64ToBlob(out.data);
    images[index].processedBlob = blob;
    images[index].processedSize = out.newSize;
    setProgress(100);
    showToast(`Processed ${imgObj.name} (server) — ${formatBytes(out.newSize)}`);
    updatePreviewProcessed(index, out.data, out.newSize);
  } else {
    const processed = await clientResizeCompress(imgObj.file, width, height, q, (p)=> setProgress(p));
    images[index].processedBlob = processed.blob;
    images[index].processedSize = processed.size;
    setProgress(100);
    showToast(`Processed ${imgObj.name} — ${formatBytes(processed.size)}`);
    updatePreviewProcessed(index, await blobToBase64(processed.blob), processed.size);
  }
}

processBtn.addEventListener('click', async ()=>{
  if(images.length===0) return alert('Add some images first');
  processedResults = [];
  const {width, height} = getDimsFromPreset();
  const q = +qualityEl.value;
  batchProgress.value = 0;
  if(useServer.checked){

    const payload = {images: [], width, height, quality: q};
    for(const im of images){
      payload.images.push({name: im.name, data: await fileToBase64(im.file)});
    }
    const res = await fetch('/api/optimize', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const j = await res.json();

    j.results.forEach((r,idx)=>{
      images[idx].processedBlob = base64ToBlob(r.data);
      images[idx].processedSize = r.newSize;
    });
    setProgress(100);
  } else {
   
    for(let i=0;i<images.length;i++){
      const processed = await clientResizeCompress(images[i].file, width, height, q, (p)=>{
        const overall = Math.round((i + p/100) / images.length * 100);
        setProgress(overall);
      });
      images[i].processedBlob = processed.blob;
      images[i].processedSize = processed.size;
    }
    setProgress(100);
  }

  renderProcessedCards();
  updateTotalSaved();
});

downloadZip.addEventListener('click', async ()=>{
  const zip = new JSZip();
  let count = 0;
  for(const im of images){
    let blob = im.processedBlob;
    if(!blob){
  
      const {width,height} = getDimsFromPreset();
      const q = +qualityEl.value;
      const r = await clientResizeCompress(im.file, width, height, q, ()=>{});
      blob = r.blob;
    }
    const arrayBuffer = await blob.arrayBuffer();
    zip.file(safeName(im.name), arrayBuffer);
    count++;
  }
  batchProgress.value = 0;
  const content = await zip.generateAsync({type:'blob'}, (meta)=> {
    batchProgress.value = Math.round(meta.percent);
  });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url; a.download = `resized_${Date.now()}.zip`; a.click();
  URL.revokeObjectURL(url);
  batchProgress.value = 100;
});

resetBtn.addEventListener('click', ()=>{
  images = [];
  processedResults = [];
  cards.innerHTML = '';
  updateSummary();
  showToast('Reset done');
});

modeToggle.addEventListener('change', ()=>{
  if(modeToggle.checked){
    document.documentElement.style.setProperty('--bg','#0f172a');
    document.documentElement.style.setProperty('--card','rgba(10,10,20,0.55)');
    document.documentElement.style.setProperty('--accent','#06b6d4');
    modeLabel.textContent = 'Night';
  } else {
    document.documentElement.style.removeProperty('--bg');
    document.documentElement.style.removeProperty('--card');
    document.documentElement.style.removeProperty('--accent');
    modeLabel.textContent = 'Day';
  }
});
async function clientResizeCompress(file, width, height, quality, onProgress = ()=>{}){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = async ()=>{
      let targetW = width || img.naturalWidth;
      let targetH = height || img.naturalHeight;
      if(!width && !height){ targetW = img.naturalWidth; targetH = img.naturalHeight; }
      const canvas = document.createElement('canvas');
      const ratio = Math.min(targetW / img.naturalWidth, targetH / img.naturalHeight);
      canvas.width = Math.round(img.naturalWidth * ratio);
      canvas.height = Math.round(img.naturalHeight * ratio);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob)=>{
        const size = blob.size;
        onProgress(100);
        resolve({blob, size});
      }, 'image/jpeg', quality/100);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function fileToBase64(file){
  return new Promise((res,rej)=>{
    const fr = new FileReader();
    fr.onload = ()=> res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
function blobToBase64(blob){
  return new Promise((res,rej)=>{
    const fr = new FileReader();
    fr.onload = ()=> res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}
function base64ToBlob(b64data){
  const parts = b64data.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const bytes = atob(parts[1]);
  const arr = new Uint8Array(bytes.length);
  for(let i=0;i<bytes.length;i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], {type:mime});
}

function formatBytes(bytes, decimals=1){
  if(bytes===0) return '0 B';
  const k = 1024, dm = decimals<0?0:decimals;
  const sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes)/Math.log(k));
  return parseFloat((bytes/Math.pow(k,i)).toFixed(dm)) + ' ' + sizes[i];
}

function setProgress(p){ batchProgress.value = p; }

function safeName(name){ return name.replace(/\s+/g,'_'); }

function getDimsFromPreset(){
  const v = presetSelect.value;
  if(v==='1080x1080') return {width:1080, height:1080};
  if(v==='1080x1920') return {width:1080, height:1920};
  if(v==='1200x675') return {width:1200, height:675};
  return {width:null,height:null};
}

function updatePreviewProcessed(index, base64data, size){
  const card = cards.children[index];
  if(!card) return;
  const img = card.querySelector('img');
  img.src = base64data;
  const meta = card.querySelector('.meta');
  meta.innerHTML = `${images[index].name} <div>${formatBytes(images[index].originalSize)} → ${formatBytes(size)}</div>`;
}

function renderProcessedCards(){
  cards.innerHTML = '';
  images.forEach((img,i)=>{
    const el = document.createElement('div');
    el.className = 'card';
    const previewURL = img.processedBlob ? URL.createObjectURL(img.processedBlob) : img.url;
    el.innerHTML = `
      <img src="${previewURL}" alt="${img.name}" />
      <div class="meta">
        <div>${img.name}</div>
        <div>${formatBytes(img.originalSize)} → ${img.processedSize? formatBytes(img.processedSize) : '—'}</div>
      </div>
      <div class="row">
        <button data-i="${i}" class="remove">Remove</button>
      </div>
    `;
    cards.appendChild(el);
  });
  document.querySelectorAll('.remove').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const i = +e.target.dataset.i;
      images.splice(i,1); renderProcessedCards(); updateTotalSaved();
    });
  });
}

function updateTotalSaved(){
  const original = images.reduce((s,i)=>s+(i.originalSize||0),0);
  const after = images.reduce((s,i)=>s+(i.processedSize||0),0);
  if(original>0){
    sizeSummary.textContent = `Reduced ${formatBytes(original)} → ${formatBytes(after)} (Saved ${formatBytes(original-after)})`;
  } else sizeSummary.textContent = 'No images yet';
}

function showToast(msg){
  console.log(msg);
  sizeSummary.textContent = msg;
  setTimeout(()=> updateSummary(), 1500);
}
