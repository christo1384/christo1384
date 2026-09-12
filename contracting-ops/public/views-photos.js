// Phase 3: the job photo record. Every photo carries the stage it was taken at,
// which is what makes it worth anything six months later.
import { api, get, esc, list, titleCase, openForm, openLightbox, toast, attempt, refresh, state } from './ui.js';

/** Shared with receipts: shrink in the browser so wifi uploads stay quick. */
async function prepareUpload(file, maxDim = 1800, quality = 0.85) {
  if (!file.type.startsWith('image/')) return { blob: file, name: file.name };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return { blob: file, name: file.name };

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    bitmap.close?.();
    return blob ? { blob, name: `${file.name.replace(/\.\w+$/, '')}.jpg` } : { blob: file, name: file.name };
  } catch {
    return { blob: file, name: file.name };
  }
}

export async function renderJobPhotos(container, jobId) {
  const { counts, photos } = await get(`/api/jobs/${jobId}/photos`);
  const stages = state.meta.photo_stages ?? ['before', 'progress', 'after', 'issue'];

  const tile = (p) => `<figure class="photo">
    <button class="photo-btn" data-photo="${p.id}" type="button">
      <img src="/api/attachments/${p.id}" alt="${esc(p.caption || p.stage)}" loading="lazy">
    </button>
    <figcaption>
      <span class="pill stage-${esc(p.stage)}">${esc(titleCase(p.stage))}</span>
      ${p.caption ? `<span class="meta"> ${esc(p.caption)}</span>` : ''}
      <button class="btn btn-sm" data-edit-photo="${p.id}" type="button">Edit</button>
    </figcaption>
  </figure>`;

  container.innerHTML = `
    <div class="card-head">
      <h2>Photos</h2>
      <span class="meta">${stages.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(', ')}</span>
      <div class="row" style="margin-left:auto">
        <button class="btn btn-sm btn-primary" id="add-photo" type="button">Add photo</button>
      </div>
    </div>
    <div class="card-body">
      ${photos.length
        ? `<div class="photo-grid">${photos.map(tile).join('')}</div>`
        : '<p class="muted" style="margin:0">No photos yet. Before-and-after shots are the cheapest insurance there is.</p>'}
    </div>`;

  container.querySelectorAll('[data-photo]').forEach((btn) => {
    btn.addEventListener('click', () => openLightbox(`/api/attachments/${btn.dataset.photo}`));
  });
  container.querySelectorAll('[data-edit-photo]').forEach((btn) => {
    const photo = photos.find((p) => String(p.id) === btn.dataset.editPhoto);
    btn.addEventListener('click', () => editPhoto(photo));
  });
  document.getElementById('add-photo').addEventListener('click', () => addPhoto(jobId));
}

async function addPhoto(jobId) {
  const stages = state.meta.photo_stages ?? ['before', 'progress', 'after', 'issue'];
  const form = await openForm({
    title: 'Add a photo',
    submitLabel: 'Upload',
    fields: [
      { name: 'photo', label: 'Photo', type: 'file', capture: true, required: true, accept: 'image/*' },
      { name: 'stage', label: 'When was this?', type: 'select', value: 'progress',
        options: stages.map((s) => ({ value: s, label: titleCase(s) })) },
      { name: 'caption', label: 'What does it show?' },
    ],
  });
  if (!form) return;

  try {
    toast('Uploading…');
    const { blob, name } = await prepareUpload(form.photo);
    const query = new URLSearchParams({ stage: form.stage, caption: form.caption || '', filename: name });
    const res = await fetch(`/api/jobs/${jobId}/photos?${query}`, {
      method: 'POST',
      headers: { 'content-type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Upload failed (${res.status})`);
    toast('Photo added');
    refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function editPhoto(photo) {
  const stages = state.meta.photo_stages ?? ['before', 'progress', 'after', 'issue'];
  const form = await openForm({
    title: 'Edit photo',
    fields: [
      { name: 'stage', label: 'Stage', type: 'select', value: photo.stage,
        options: stages.map((s) => ({ value: s, label: titleCase(s) })) },
      { name: 'caption', label: 'Caption', value: photo.caption ?? '' },
      { name: 'remove', label: 'Delete this photo', type: 'checkbox', value: false },
    ],
  });
  if (!form) return;

  if (form.remove) {
    if (!confirm('Delete this photo for good?')) return;
    await attempt(() => api('DELETE', `/api/photos/${photo.id}`), 'Photo deleted');
    return;
  }
  await attempt(() => api('PATCH', `/api/photos/${photo.id}`,
    { stage: form.stage, caption: form.caption }), 'Photo updated');
}
