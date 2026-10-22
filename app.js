(() => {
  'use strict';

  const ENC_HEADER = 'ENCRYPTED-NOTE:v1\n'; // primeira linha de arquivo protegido por senha
  const TEXT_EXTS = ['.txt', '.md', '.text', '.log'];

  const $ = id => document.getElementById(id);
  const textarea = $('text');
  const composer = $('composer');
  const statusEl = $('status');
  const newBtn = $('new');
  const closeNoteBtn = $('close-note');
  const MODE_ICONS = {
    // no modo edição o botão mostra o olho (ir para leitura); no modo leitura, o lápis (ir para edição)
    read: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  };
  let mode = 'edit'; // 'edit' ou 'read'
  const lockBtn = $('lock');
  const locationBtn = $('location');
  const locationDialog = $('location-dialog');
  const folderBtn = $('folder-btn');
  const folderName = $('folder-name');
  const fileNameInput = $('file-name');
  const fileList = $('file-list');
  const locationStatus = $('location-status');
  const fileInput = $('file-input');
  const passDialog = $('password-dialog');
  const passForm = $('password-form');
  const passTitle = $('password-title');
  const passInput = $('pw');
  const passConfirm = $('pw-confirm');
  const passConfirmField = $('pw-confirm-field');
  const passRemove = $('password-remove');
  const passOk = $('password-ok');
  const passError = $('password-error');
  const sideFolderBtn = $('side-folder');
  const sideFolderName = $('side-folder-name');
  const sideSearch = $('side-search');
  const sideList = $('side-list');
  const sideStatus = $('side-status');
  const readerDialog = $('reader-dialog');
  const readerTitle = $('reader-title');
  const readerText = $('reader-text');

  let dirHandle = null;   // pasta atual onde as notas são salvas (só Chrome/Edge)
  let dirPath = '';       // caminho exibido, ex.: "notas / 2026 / ideias"
  const newFolderInput = $('new-folder-name');
  const newFolderBtn = $('new-folder-btn');
  let fileName = 'untitled.txt';
  let savedName = null;   // nome com que a nota foi aberta/salva nesta pasta
  let filePassword = null; // senha da nota atual (null = sem senha)
  let lastSaved = '';
  let dirty = false;
  let passMode = 'set';
  let passResolve = null;

  // ---------- texto que cresce com o conteúdo ----------
  function autoGrow() {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('err', isError);
    // reinicia a animação de entrada da mensagem
    statusEl.classList.remove('pop');
    void statusEl.offsetWidth;
    statusEl.classList.add('pop');
  }

  function refresh() {
    autoGrow();
    dirty = textarea.value !== lastSaved;
    document.title = `${fileName}${dirty ? ' *' : ''} — Notes`;
    lockBtn.classList.toggle('active', filePassword !== null);
    lockBtn.title = filePassword !== null ? 'Note is password protected (click to change)' : 'Set note password';
  }

  function confirmDiscard() {
    return !dirty || confirm('You have unsaved changes. Discard them?');
  }

  // ---------- modos: leitura (somente leitura) e edição ----------
  function setMode(next) {
    mode = next;
    const reading = mode === 'read';
    composer.classList.toggle('reading', reading);
    closeNoteBtn.hidden = !reading; // o botão Close aparece só ao ler uma nota aberta
    textarea.readOnly = reading;
    autoGrow();
    if (!reading) textarea.focus();
  }

  // ---------- fechar nota: esvazia o editor e volta ao modo edição ----------
  closeNoteBtn.addEventListener('click', () => {
    if (!confirmDiscard()) return;
    fileName = 'untitled.txt';
    savedName = null;
    filePassword = null;
    textarea.value = '';
    lastSaved = '';
    refresh();
    renderSideList();
    setMode('edit');
    setStatus('');
  });

  // ---------- novo ----------
  function newNote() {
    if (!confirmDiscard()) return;
    fileName = 'untitled.txt';
    savedName = null;
    filePassword = null;
    textarea.value = '';
    lastSaved = '';
    refresh();
    renderSideList();
    setMode('edit');
    setStatus('New note');
    textarea.focus();
  }

  // ---------- criptografia (AES-GCM, chave via PBKDF2) ----------
  const bytesToBase64 = bytes => {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  };
  const base64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  async function deriveKey(password, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  // Formato: salt (16 bytes) + iv (12 bytes) + texto cifrado, em base64
  async function encryptText(password, text) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
    const all = new Uint8Array(salt.length + iv.length + cipher.length);
    all.set(salt, 0);
    all.set(iv, salt.length);
    all.set(cipher, salt.length + iv.length);
    return bytesToBase64(all);
  }

  // Lança erro se a senha estiver errada (a autenticação do AES-GCM falha)
  async function decryptText(password, payload) {
    const all = base64ToBytes(payload.trim());
    const salt = all.slice(0, 16);
    const iv = all.slice(16, 28);
    const cipher = all.slice(28);
    const key = await deriveKey(password, salt);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
  }

  // ---------- pedido de senha ----------
  // mode 'set': define/troca senha (com confirmação); 'unlock': pede a senha de um arquivo
  // Resolve com a senha, '' para remover a senha, ou null se cancelar
  function askPassword(mode, error = '', canRemove = false) {
    passMode = mode;
    const setting = mode === 'set';
    passTitle.textContent = setting ? 'Note password' : 'Password required';
    passOk.textContent = setting ? 'Set' : 'Unlock';
    passConfirmField.hidden = !setting;
    passRemove.hidden = !canRemove;
    passInput.value = '';
    passConfirm.value = '';
    passError.textContent = error;
    passDialog.hidden = false;
    passInput.focus();
    return new Promise(resolve => { passResolve = resolve; });
  }

  function closePassword(result) {
    passDialog.hidden = true;
    const resolve = passResolve;
    passResolve = null;
    if (resolve) resolve(result);
    textarea.focus();
  }

  passForm.addEventListener('submit', e => {
    e.preventDefault();
    const password = passInput.value;
    if (passMode === 'unlock') return closePassword(password);
    if (!password) return void (passError.textContent = 'Enter a password.');
    if (password !== passConfirm.value) return void (passError.textContent = 'Passwords do not match.');
    closePassword(password);
  });

  passRemove.addEventListener('click', () => closePassword(''));
  $('password-cancel').addEventListener('click', () => closePassword(null));

  // Pede a senha até acertar ou cancelar. Resolve com { text, password } ou null
  async function unlock(payload) {
    let error = '';
    for (;;) {
      const password = await askPassword('unlock', error);
      if (password === null) return null;
      try {
        return { text: await decryptText(password, payload), password };
      } catch {
        error = 'Wrong password';
      }
    }
  }

  lockBtn.addEventListener('click', async () => {
    const result = await askPassword('set', '', filePassword !== null);
    if (result === null) return;
    filePassword = result === '' ? null : result;
    refresh();
    setStatus(filePassword !== null
      ? 'Password set. The note will be saved encrypted.'
      : 'Password removed. The note will be saved as plain text.');
  });

  // ---------- abrir ----------
  async function loadFile(file, handle, startMode = 'read') {
    const raw = await file.text();
    let text = raw;
    let password = null;
    if (raw.startsWith(ENC_HEADER)) {
      const result = await unlock(raw.slice(ENC_HEADER.length));
      if (!result) return false;
      text = result.text;
      password = result.password;
    }
    fileName = file.name;
    savedName = handle ? file.name : null;
    filePassword = password;
    textarea.value = text;
    lastSaved = text;
    refresh();
    renderSideList();
    setMode(startMode);
    setStatus(`Opened ${file.name}`);
    return true;
  }

  // ---------- pop-up de pasta e nome ----------
  const extOf = name => '.' + name.split('.').pop().toLowerCase();

  // Nome final: sem extensão vira .txt
  function chosenFileName() {
    const name = fileNameInput.value.trim() || 'untitled';
    return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.txt`;
  }

  async function listFiles() {
    fileList.replaceChildren();
    if (!dirHandle) {
      locationStatus.textContent = window.showDirectoryPicker
        ? 'Choose a folder to see your notes.'
        : 'Choosing a folder needs Chrome or Edge; files go to Downloads here.';
      return;
    }
    try {
      const names = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && TEXT_EXTS.includes(extOf(entry.name))) names.push(entry.name);
      }
      names.sort((a, b) => a.localeCompare(b));
      locationStatus.textContent = names.length ? 'Click a note to open it.' : 'No text notes in this folder yet.';
      for (const name of names) {
        const li = document.createElement('li');
        li.className = name === fileName ? 'file-item current' : 'file-item';
        li.tabIndex = 0;
        li.textContent = name;
        li.addEventListener('click', () => openFromFolder(name));
        li.addEventListener('keydown', e => {
          if (e.key === 'Enter') openFromFolder(name);
        });
        fileList.append(li);
      }
    } catch (e) {
      locationStatus.textContent = `Could not read folder: ${e.message}`;
    }
  }

  async function openFromFolder(name, startMode = 'read') {
    if (!confirmDiscard()) return;
    try {
      const handle = await dirHandle.getFileHandle(name);
      if (await loadFile(await handle.getFile(), handle, startMode)) locationDialog.hidden = true;
    } catch (e) {
      locationStatus.textContent = `Open failed: ${e.message}`;
    }
  }

  function openLocation() {
    fileNameInput.value = fileName;
    folderName.textContent = dirPath || 'Downloads (browser default)';
    folderBtn.disabled = !window.showDirectoryPicker;
    newFolderBtn.disabled = !dirHandle;
    newFolderInput.disabled = !dirHandle;
    locationStatus.textContent = '';
    locationDialog.hidden = false;
    listFiles();
    fileNameInput.focus();
    fileNameInput.select();
  }

  function closeLocation() {
    locationDialog.hidden = true;
    textarea.focus();
  }

  locationBtn.addEventListener('click', openLocation);
  $('location-cancel').addEventListener('click', closeLocation);

  // Pasta compartilhada pelo pop-up de salvar e pelo painel lateral
  async function chooseFolder() {
    try {
      dirHandle = await showDirectoryPicker({ mode: 'readwrite' });
      dirPath = dirHandle.name;
      folderName.textContent = dirPath;
      newFolderBtn.disabled = false;
      newFolderInput.disabled = false;
      await listFiles();
      await refreshSidebar();
    } catch (e) {
      if (e.name !== 'AbortError') setStatus(`Folder failed: ${e.message}`, true);
    }
  }

  folderBtn.addEventListener('click', chooseFolder);
  sideFolderBtn.addEventListener('click', chooseFolder);

  // Cria uma subpasta dentro da pasta atual e passa a salvar nela
  async function createSubfolder() {
    const name = newFolderInput.value.trim();
    if (!dirHandle) return;
    if (!name || name === '.' || name === '..' || /[\/\\]/.test(name)) {
      locationStatus.textContent = 'Enter a folder name without slashes.';
      return;
    }
    try {
      let exists = true;
      try {
        await dirHandle.getDirectoryHandle(name);
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e;
        exists = false;
      }
      if (exists) {
        locationStatus.textContent = `A folder named "${name}" already exists here.`;
        return;
      }
      dirHandle = await dirHandle.getDirectoryHandle(name, { create: true });
      dirPath = `${dirPath} / ${name}`;
      folderName.textContent = dirPath;
      newFolderInput.value = '';
      await listFiles();
      await refreshSidebar();
      locationStatus.textContent = `Created ${name}. Notes will be saved there.`;
    } catch (e) {
      locationStatus.textContent = `Could not create folder: ${e.message}`;
    }
  }

  newFolderBtn.addEventListener('click', createSubfolder);
  newFolderInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createSubfolder();
    }
  });

  // Fallback para navegadores sem seletor de pastas
  $('open-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file || !confirmDiscard()) return;
    dirHandle = null;
    dirPath = '';
    refreshSidebar();
    if (await loadFile(file, null)) locationDialog.hidden = true;
  });

  // Salvar: o nome do pop-up é aplicado e a nota é gravada na pasta escolhida
  $('location-save').addEventListener('click', async () => {
    fileName = chosenFileName();
    locationDialog.hidden = true;
    await save();
  });

  // ---------- painel lateral: notas da pasta, busca e exclusão ----------
  let sideNotes = []; // todas as notas da pasta ({ name, tags }), antes do filtro da busca
  let sideError = '';

  // Tags são palavras com # escritas no texto, ex.: #trabalho. Sem diferenciar maiúsculas
  const TAG_RE = /(^|\s)#(\p{L}[\p{L}\p{N}_-]*)/gu;
  function extractTags(text) {
    const tags = new Set();
    for (const m of text.matchAll(TAG_RE)) tags.add(m[2].toLowerCase());
    return [...tags].sort();
  }

  // Notas protegidas ficam sem tags: o conteúdo só é lido com a senha
  async function readNotes() {
    const notes = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && TEXT_EXTS.includes(extOf(entry.name))) notes.push({ name: entry.name, tags: [] });
    }
    notes.sort((a, b) => a.name.localeCompare(b.name));
    await Promise.all(notes.map(async note => {
      try {
        const raw = await (await (await dirHandle.getFileHandle(note.name)).getFile()).text();
        if (!raw.startsWith(ENC_HEADER)) note.tags = extractTags(raw);
      } catch {
        // arquivo ilegível: a nota aparece na lista, sem tags
      }
    }));
    return notes;
  }

  async function refreshSidebar() {
    sideFolderName.textContent = dirPath || 'No folder chosen';
    sideNotes = [];
    sideError = '';
    if (dirHandle) {
      try {
        sideNotes = await readNotes();
      } catch (e) {
        sideError = `Could not read folder: ${e.message}`;
      }
    }
    renderSideList();
  }

  function makeItemButton(label, paths, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item-btn';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // Janela de leitura: mostra o texto da nota sem permitir edição
  async function readNote(name) {
    if (!dirHandle) return;
    try {
      const raw = await (await (await dirHandle.getFileHandle(name)).getFile()).text();
      let text = raw;
      if (raw.startsWith(ENC_HEADER)) {
        const result = await unlock(raw.slice(ENC_HEADER.length));
        if (!result) return;
        text = result.text;
      }
      readerTitle.textContent = name;
      readerText.textContent = text;
      readerDialog.hidden = false;
      $('reader-close').focus();
    } catch (e) {
      setStatus(`Read failed: ${e.message}`, true);
    }
  }

  function closeReader() {
    readerDialog.hidden = true;
    textarea.focus();
  }

  $('reader-close').addEventListener('click', closeReader);

  // ---------- sobre o app ----------
  const aboutDialog = $('about-dialog');
  const aboutBtn = $('about-btn');

  function closeAbout() {
    aboutDialog.hidden = true;
    textarea.focus();
  }

  aboutBtn.addEventListener('click', () => {
    aboutDialog.hidden = false;
    $('about-close').focus();
  });
  $('about-close').addEventListener('click', closeAbout);

  // ---------- ajuda: documentação de uso ----------
  const helpDialog = $('help-dialog');

  function closeHelp() {
    helpDialog.hidden = true;
    textarea.focus();
  }

  $('help-btn').addEventListener('click', () => {
    helpDialog.hidden = false;
    $('help-close').focus();
  });
  $('help-close').addEventListener('click', closeHelp);

  // Desenha a lista aplicando o termo da busca (sem diferenciar maiúsculas).
  // Busca comum casa com nome ou tag; começando com # casa só com tags (ex.: "#trab")
  function renderSideList() {
    const rawQuery = sideSearch.value.trim();
    const query = rawQuery.toLowerCase();
    const shown = sideNotes.filter(({ name, tags }) => (
      query.startsWith('#')
        ? tags.some(tag => tag.startsWith(query.slice(1)))
        : name.toLowerCase().includes(query) || tags.some(tag => tag.includes(query))
    ));
    sideList.replaceChildren();

    for (const [i, { name }] of shown.entries()) {
      const li = document.createElement('li');
      li.style.setProperty('--i', i); // atraso da entrada escalonada
      li.className = name === fileName ? 'file-item side-item current' : 'file-item side-item';
      li.tabIndex = 0;
      li.title = name;
      const label = document.createElement('span');
      label.className = 'file-name';
      label.textContent = name;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'delete-btn';
      del.textContent = '×';
      del.title = `Delete ${name}`;
      del.setAttribute('aria-label', `Delete ${name}`);
      del.addEventListener('click', e => {
        e.stopPropagation();
        deleteNote(name);
      });
      const readBtn = makeItemButton(`Read ${name} in a window`, MODE_ICONS.read, () => readNote(name));
      const editBtn = makeItemButton(`Edit ${name}`, MODE_ICONS.edit, () => openFromFolder(name, 'edit'));
      li.append(label, readBtn, editBtn, del);
      li.addEventListener('click', () => openFromFolder(name));
      li.addEventListener('keydown', e => {
        if (e.key === 'Enter') openFromFolder(name);
      });
      sideList.append(li);
    }

    if (sideError) sideStatus.textContent = sideError;
    else if (!dirHandle) sideStatus.textContent = window.showDirectoryPicker ? 'Choose a folder to see your notes.' : 'Folder browsing needs Chrome or Edge.';
    else if (!sideNotes.length) sideStatus.textContent = 'No notes in this folder yet.';
    else if (!shown.length) sideStatus.textContent = `No notes match "${rawQuery}".`;
    else sideStatus.textContent = '';
  }

  sideSearch.addEventListener('input', renderSideList);

  // Apaga a nota da pasta, depois de confirmar. Nota protegida só é apagada depois de digitar a senha dela
  async function deleteNote(name) {
    if (!dirHandle) return;
    try {
      const raw = await (await (await dirHandle.getFileHandle(name)).getFile()).text();
      if (raw.startsWith(ENC_HEADER) && !(await unlock(raw.slice(ENC_HEADER.length)))) return;
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      await dirHandle.removeEntry(name);
      if (savedName === name) {
        // a nota aberta deixou de existir no disco: volta a ser "não salva"
        savedName = null;
        lastSaved = null;
        refresh();
      }
      setStatus(`Deleted ${name}`);
    } catch (e) {
      setStatus(`Delete failed: ${e.message}`, true);
    }
    await refreshSidebar();
  }

  // ---------- salvar ----------
  async function fileExists(dir, name) {
    try {
      await dir.getFileHandle(name);
      return true;
    } catch (e) {
      if (e.name === 'NotFoundError') return false;
      throw e;
    }
  }

  function downloadFile(name, content) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function save() {
    const text = textarea.value;
    try {
      const body = filePassword !== null ? ENC_HEADER + await encryptText(filePassword, text) : text;
      if (dirHandle) {
        if (fileName !== savedName && await fileExists(dirHandle, fileName) && !confirm(`"${fileName}" already exists. Replace it?`)) return;
        const handle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(body);
        await writable.close();
        savedName = fileName;
      } else {
        downloadFile(fileName, body);
      }
      lastSaved = text;
      refresh();
      refreshSidebar();
      setStatus(dirHandle ? `Saved ${dirPath}/${fileName}` : `Downloaded ${fileName}`);
    } catch (err) {
      if (err.name !== 'AbortError') setStatus(`Save failed: ${err.message}`, true);
    }
  }

  composer.addEventListener('submit', e => {
    e.preventDefault();
    save();
  });

  // ---------- eventos ----------
  textarea.addEventListener('input', refresh);
  textarea.addEventListener('keydown', e => {
    // Enter sem Shift não envia nada; Cmd/Ctrl+Enter salva
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  });
  window.addEventListener('resize', autoGrow);

  newBtn.addEventListener('click', newNote);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!passDialog.hidden) return closePassword(null);
      if (!readerDialog.hidden) return closeReader();
      if (!aboutDialog.hidden) return closeAbout();
      if (!helpDialog.hidden) return closeHelp();
      if (!locationDialog.hidden) return closeLocation();
    }
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      if (e.shiftKey) openLocation();
      else save();
    } else if (key === 'n') {
      e.preventDefault();
      newNote();
    } else if (key === 'e') {
      e.preventDefault();
      setMode(mode === 'edit' ? 'read' : 'edit');
    }
  });

  window.addEventListener('beforeunload', e => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- tema dia / noite ----------
  const THEME_KEY = 'yournotes-theme';
  const themeSwitch = $('theme-switch');

  function applyTheme(name) {
    document.documentElement.dataset.theme = name;
    themeSwitch.setAttribute('aria-checked', String(name === 'night'));
    themeSwitch.title = name === 'night' ? 'Switch to day' : 'Switch to night';
    localStorage.setItem(THEME_KEY, name);
  }

  themeSwitch.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'day' ? 'night' : 'day');
  });

  applyTheme(localStorage.getItem(THEME_KEY) === 'day' ? 'day' : 'night');

  refresh();
  refreshSidebar();
  textarea.focus();
})();
