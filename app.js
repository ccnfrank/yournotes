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
  const undoBtn = $('undo');
  let mode = 'edit'; // 'edit' ou 'read'
  const MODE_ICONS = {
    // no modo edição o botão mostra o olho (ir para leitura); no modo leitura, o lápis (ir para edição)
    read: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  };
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
  const webSearch = $('web-search');
  const webStatus = $('web-status');
  const webToggle = $('web-toggle');
  const webBack = $('web-back');
  const webZoom = $('web-zoom');
  const webZoomValue = $('web-zoom-value');
  const webSearchPop = $('web-search-pop');
  const webSearchClose = $('web-search-close');
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
  // A área de escrita tem altura fixa; a lista de notas fica na janela pop-up (⌘O)
  const NOTE_HEIGHT = 400;
  function autoGrow() {
    textarea.style.height = `${NOTE_HEIGHT}px`;
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

  // ---------- salvar sozinho e desfazer ----------
  let autoSaveTimer = null;

  // Nota que já tem arquivo na pasta, em modo edição: grava 1 s depois de parar de digitar
  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    if (!dirHandle || savedName === null || mode !== 'edit') return;
    autoSaveTimer = setTimeout(() => {
      if (dirty && savedName !== null && mode === 'edit') save();
    }, 1000);
  }

  // Histórico de desfazer: cada rajada de digitação (separada por pausa de 1 s) vira um passo
  const UNDO_LIMIT = 10;
  let undoStack = [];     // textos anteriores a cada passo
  let lastText = '';      // texto logo após a última digitação
  let lastInputAt = 0;

  function resetHistory() {
    undoStack = [];
    lastText = textarea.value;
    lastInputAt = 0;
  }

  function onTyping() {
    const now = Date.now();
    if (now - lastInputAt > 1000) {
      undoStack.push(lastText); // a rajada que começa agora desfaz até o texto de antes dela
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }
    lastInputAt = now;
    lastText = textarea.value;
    refresh();
    scheduleAutoSave();
  }

  function undo() {
    if (mode !== 'edit' || !undoStack.length) return;
    textarea.value = undoStack.pop();
    lastText = textarea.value;
    lastInputAt = 0;
    refresh();
    scheduleAutoSave();
    textarea.focus();
  }

  function confirmDiscard() {
    return !dirty || confirm('You have unsaved changes. Discard them?');
  }

  // ---------- modos: leitura (somente leitura) e edição ----------
  function setMode(next) {
    mode = next;
    const reading = mode === 'read';
    composer.classList.toggle('reading', reading);
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
    resetHistory();
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
    resetHistory();
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
    resetHistory();
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

  // ---------- janela de notas: notas da pasta, busca e exclusão ----------
  let sideNotes = []; // todas as notas da pasta ({ name, tags }), antes do filtro da busca
  let sideError = '';
  const notesDialog = $('notes-dialog');

  // Abre a janela com a lista atualizada da pasta e foca a busca
  function openNotes() {
    if (!notesDialog.hidden) return;
    notesDialog.hidden = false;
    refreshSidebar();
    sideSearch.focus();
  }

  function closeNotes() {
    notesDialog.hidden = true;
    textarea.focus();
  }

  $('notes-close').addEventListener('click', closeNotes);
  $('show-files').addEventListener('click', openNotes);

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
      if (entry.kind === 'file' && TEXT_EXTS.includes(extOf(entry.name))) notes.push({ name: entry.name, tags: [], mentions: [] });
    }
    notes.sort((a, b) => a.name.localeCompare(b.name));
    const names = notes.map(n => n.name);
    await Promise.all(notes.map(async note => {
      try {
        const raw = await (await (await dirHandle.getFileHandle(note.name)).getFile()).text();
        if (!raw.startsWith(ENC_HEADER)) {
          note.tags = extractTags(raw);
          note.mentions = Links.mentionedNames(raw, names); // notas citadas no texto
        }
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
    await refreshWeb();
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

  // Ícone com a legenda embaixo. Clicar na legenda aciona o mesmo ícone
  function withCaption(control, text) {
    const wrap = document.createElement('span');
    wrap.className = 'item-action';
    const caption = document.createElement('span');
    caption.className = 'item-caption';
    caption.textContent = text;
    wrap.append(control, caption);
    wrap.addEventListener('click', e => {
      e.stopPropagation();
      control.click();
    });
    return wrap;
  }

  // Desenha a lista aplicando o termo da busca (sem diferenciar maiúsculas).
  // Busca comum casa com nome ou tag; começando com # casa só com tags (ex.: "#trab")
  // webMatches guarda os nomes que casam, para a teia destacar os mesmos pontos; null sem busca
  let webMatches = null;
  function renderSideList() {
    const rawQuery = sideSearch.value.trim();
    const query = rawQuery.toLowerCase();
    const shown = sideNotes.filter(({ name, tags }) => (
      query.startsWith('#')
        ? tags.some(tag => tag.startsWith(query.slice(1)))
        : name.toLowerCase().includes(query) || tags.some(tag => tag.includes(query))
    ));
    webMatches = query ? new Set(shown.map(n => n.name)) : null;
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
      label.title = 'Click to rename';
      label.addEventListener('click', e => {
        e.stopPropagation(); // não abre a nota: o clique no nome é para renomear
        startRename(name, label);
      });
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
      li.append(label, withCaption(readBtn, 'view'), withCaption(editBtn, 'edit'), withCaption(del, 'trash it'));
      li.addEventListener('click', () => openFromFolder(name));
      li.addEventListener('keydown', e => {
        if (e.key === 'Enter') openFromFolder(name);
      });
      sideList.append(li);
    }

    let text = '';
    if (sideError) text = sideError;
    else if (!dirHandle) text = window.showDirectoryPicker ? 'Choose a folder to see your notes.' : 'Folder browsing needs Chrome or Edge.';
    else if (!sideNotes.length) text = 'No notes in this folder yet.';
    else if (!shown.length) text = `No notes match "${rawQuery}".`;
    sideStatus.textContent = text;
    webStatus.textContent = text;
    webSearch.value = sideSearch.value;
    autoGrow(); // a lista mudou de tamanho: a área de escrita acompanha
  }

  // Troca o nome da nota por um campo de texto. Enter confirma, Esc ou sair do campo cancela
  function startRename(name, label) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = name;
    input.spellcheck = false;
    input.setAttribute('aria-label', `Rename ${name}`);
    let done = false;
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
      e.stopPropagation(); // a tecla não chega à lista nem aos atalhos da teia
      if (e.key === 'Enter') {
        e.preventDefault();
        done = true;
        renameNote(name, input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        done = true;
        renderSideList();
      }
    });
    input.addEventListener('blur', () => {
      if (done) return;
      done = true;
      renderSideList();
    });
    label.replaceWith(input);
    input.focus();
    input.select();
  }

  // Renomeia o arquivo na pasta. Mantém a nota aberta e as ligações da teia apontando para o novo nome
  async function renameNote(oldName, typedName) {
    if (!dirHandle) return;
    const typed = typedName.trim();
    if (!typed || typed === oldName) return renderSideList();
    if (/[\/\\]/.test(typed) || typed === '.' || typed === '..') {
      setStatus('Enter a name without slashes.', true);
      return renderSideList();
    }
    const newName = /\.[a-z0-9]+$/i.test(typed) ? typed : `${typed}.txt`;
    if (!TEXT_EXTS.includes(extOf(newName))) {
      setStatus('Use .txt, .md, .text or .log.', true);
      return renderSideList();
    }
    try {
      if (await fileExists(dirHandle, newName)) {
        setStatus(`"${newName}" already exists.`, true);
        return renderSideList();
      }
      const handle = await dirHandle.getFileHandle(oldName);
      await handle.move(newName);
    } catch (e) {
      setStatus(`Rename failed: ${e.message}`, true);
      return refreshSidebar();
    }
    if (savedName === oldName) savedName = newName;
    if (fileName === oldName) {
      fileName = newName;
      refresh();
    }
    if (webLinks.some(pair => pair.includes(oldName))) {
      const renamed = webLinks.map(pair => pair.map(n => (n === oldName ? newName : n)));
      webLinks = Links.normalizeLinks(renamed, new Set([...sideNotes.map(n => n.name === oldName ? newName : n.name), newName]));
      await writeLinks();
    }
    setStatus(`Renamed to ${newName}`);
    await refreshSidebar();
  }

  // A busca da lista e a da teia são a mesma: digitar em uma atualiza a outra
  sideSearch.addEventListener('input', renderSideList);
  webSearch.addEventListener('input', () => {
    sideSearch.value = webSearch.value;
    renderSideList();
  });

  // Apaga a nota da pasta, depois de confirmar. Nota protegida só é apagada depois de digitar a senha dela
  async function deleteNote(name) {
    if (!dirHandle) return;
    try {
      const raw = await (await (await dirHandle.getFileHandle(name)).getFile()).text();
      if (raw.startsWith(ENC_HEADER) && !(await unlock(raw.slice(ENC_HEADER.length)))) return;
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      await dirHandle.removeEntry(name);
      if (webLinks.some(pair => pair.includes(name))) {
        webLinks = webLinks.filter(pair => !pair.includes(name));
        await writeLinks();
      }
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
  textarea.addEventListener('input', onTyping);
  textarea.addEventListener('keydown', e => {
    // Enter sem Shift não envia nada; Cmd/Ctrl+Enter salva
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  });
  window.addEventListener('resize', autoGrow);

  newBtn.addEventListener('click', newNote);
  undoBtn.addEventListener('click', undo);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!passDialog.hidden) return closePassword(null);
      if (!notesDialog.hidden) return closeNotes();
      if (!readerDialog.hidden) return closeReader();
      if (!aboutDialog.hidden) return closeAbout();
      if (!helpDialog.hidden) return closeHelp();
      if (!locationDialog.hidden) return closeLocation();
      if (!webSearchPop.hidden) return closeWebSearch();
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
    } else if (key === 'o') {
      e.preventDefault();
      openNotes();
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

  // ---------- teia: cada nota é um ponto; ligações vêm de tags (automáticas) e de links.json (manuais) ----------
  const webCanvas = $('web');
  const webCtx = webCanvas.getContext('2d');
  const LINKS_FILE = 'links.json';
  const WEB_SKIP = '.composer, .web-top, .web-search-pop, .modal, .side-top, .status, button, input, textarea, select';
  const LABEL_FONT = '11px system-ui, sans-serif';
  let webLinks = [];      // ligações manuais [a, b], como estão em links.json
  let linksError = null;  // links.json ilegível: não gravamos por cima dele
  let sim = null;         // simulação da teia (Graph.createSimulation)
  const DEFAULT_WEB_ZOOM = 1.5; // 150%
  let view = { scale: DEFAULT_WEB_ZOOM, x: 0, y: 0 };
  let dragging = null;    // nome do ponto que está sendo arrastado
  let pointerStart = null; // { x, y, name, shift, moved } do gesto em andamento
  let shiftFirst = null;  // primeira nota escolhida com Shift + clique
  let selected = null;    // última nota clicada, apagada com Delete
  let panning = null;     // { x, y, vx, vy } do arrasto com o botão direito (move a teia)

  async function readLinks() {
    try {
      const raw = await (await (await dirHandle.getFileHandle(LINKS_FILE)).getFile()).text();
      return Links.parseLinksFile(raw);
    } catch (e) {
      if (e.name === 'NotFoundError') return { links: [], error: null };
      return { links: [], error: `Could not read ${LINKS_FILE}: ${e.message}` };
    }
  }

  // Mensagens vão para a barra da teia quando ela está ativa, senão para a barra do editor
  const isWebMode = () => document.body.classList.contains('web-mode');
  function notify(text, isError = false) {
    if (!isWebMode()) return setStatus(text, isError);
    webStatus.textContent = text;
    webStatus.classList.toggle('err', isError);
  }

  async function writeLinks() {
    if (!dirHandle) return false;
    try {
      const handle = await dirHandle.getFileHandle(LINKS_FILE, { create: true });
      const writable = await handle.createWritable();
      await writable.write(Links.serializeLinks(webLinks));
      await writable.close();
      return true;
    } catch (e) {
      notify(`Could not save links: ${e.message}`, true);
      return false;
    }
  }

  // Todas as ligações da teia, sem repetição: tags em comum, menções no texto e ligações manuais
  function allLinks() {
    return Links.normalizeLinks(
      [...Links.noteLinks(sideNotes), ...webLinks],
      new Set(sideNotes.map(n => n.name)),
    );
  }

  // Recria a simulação com as notas e ligações atuais, mantendo a posição de quem já existia
  function rebuildSim() {
    const old = new Map((sim?.nodes ?? []).map(n => [n.name, n]));
    const names = sideNotes.map(n => n.name);
    sim = Graph.createSimulation(names, allLinks(), innerWidth, innerHeight);
    for (const n of sim.nodes) {
      const prev = old.get(n.name);
      if (prev) Object.assign(n, { x: prev.x, y: prev.y, vx: 0, vy: 0 });
    }
  }

  async function refreshWeb() {
    const loaded = dirHandle ? await readLinks() : { links: [], error: null };
    linksError = loaded.error;
    webLinks = Links.normalizeLinks(loaded.links, new Set(sideNotes.map(n => n.name)));
    rebuildSim();
    if (linksError) notify(linksError, true);
  }

  function resizeWeb() {
    const dpr = window.devicePixelRatio || 1;
    webCanvas.width = innerWidth * dpr;
    webCanvas.height = innerHeight * dpr;
    webCanvas.style.width = `${innerWidth}px`;
    webCanvas.style.height = `${innerHeight}px`;
  }

  // Converte coordenadas da tela (CSS px) para o espaço da simulação, considerando zoom
  const toWorld = (sx, sy) => [(sx - view.x) / view.scale, (sy - view.y) / view.scale];
  const toScreen = (wx, wy) => [wx * view.scale + view.x, wy * view.scale + view.y];

  // Ponto clicado: a bolinha ou o nome ao lado dela (coordenadas da tela)
  function nodeAt(sx, sy) {
    if (!sim) return null;
    webCtx.font = LABEL_FONT;
    for (const n of sim.nodes) {
      const [x, y] = toScreen(n.x, n.y);
      const labelW = webCtx.measureText(n.name).width;
      const onDot = Math.hypot(sx - x, sy - y) <= 12;
      const onLabel = sx >= x + 6 && sx <= x + 6 + labelW && sy >= y - 8 && sy <= y + 4;
      if (onDot || onLabel) return n;
    }
    return null;
  }

  function drawWeb() {
    const dpr = window.devicePixelRatio || 1;
    webCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    webCtx.clearRect(0, 0, innerWidth, innerHeight);
    if (!sim || !sim.nodes.length) return;

    const night = document.documentElement.dataset.theme !== 'day';
    const autoColor = night ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
    const manualColor = night ? 'rgba(255,190,110,0.95)' : 'rgba(170,70,20,0.95)';
    const nodeColor = night ? '#ffb3a0' : '#7a2e12';
    const labelColor = night ? '#f4f1ea' : '#1a1a1a';
    const glowColor = night ? 'rgba(255, 200, 150, 0.9)' : 'rgba(122, 46, 18, 0.6)';
    const dimmed = name => webMatches !== null && !webMatches.has(name);
    const byName = new Map(sim.nodes.map(n => [n.name, n]));
    const manualKeys = new Set(webLinks.map(([a, b]) => `${a}\u0000${b}`));

    for (const [a, b] of allLinks()) {
      const na = byName.get(a);
      const nb = byName.get(b);
      if (!na || !nb) continue;
      const [ax, ay] = toScreen(na.x, na.y);
      const [bx, by] = toScreen(nb.x, nb.y);
      const manual = manualKeys.has(`${a}\u0000${b}`);
      webCtx.lineWidth = manual ? 2 : 1.25;
      webCtx.globalAlpha = dimmed(a) || dimmed(b) ? 0.1 : 1;
      webCtx.strokeStyle = manual ? manualColor : autoColor;
      webCtx.beginPath();
      webCtx.moveTo(ax, ay);
      webCtx.lineTo(bx, by);
      webCtx.stroke();
    }

    webCtx.font = LABEL_FONT;
    for (const n of sim.nodes) {
      const [x, y] = toScreen(n.x, n.y);
      webCtx.globalAlpha = dimmed(n.name) ? 0.15 : 1;
      webCtx.fillStyle = nodeColor;
      webCtx.beginPath();
      webCtx.arc(x, y, 3, 0, Math.PI * 2);
      webCtx.fill();
      if (n.name === shiftFirst || n.name === fileName) {
        webCtx.strokeStyle = nodeColor;
        webCtx.beginPath();
        webCtx.arc(x, y, 7, 0, Math.PI * 2);
        webCtx.stroke();
      }
      webCtx.fillStyle = labelColor;
      webCtx.shadowColor = glowColor; // glow em volta do nome
      webCtx.shadowBlur = 8;
      webCtx.fillText(n.name, x + 6, y + 4);
      webCtx.shadowBlur = 0;
    }
    webCtx.globalAlpha = 1;
  }

  // Os pontos não ficam atrás da barra de busca: a área dela vira obstáculo na simulação
  const webTop = document.querySelector('.web-top');
  function updateObstacles() {
    if (!sim) return;
    const boxes = [webTop];
    if (!webSearchPop.hidden) boxes.push(webSearchPop);
    sim.setObstacles(boxes.map(el => {
      const b = el.getBoundingClientRect();
      const [x0, y0] = toWorld(b.left, b.top);
      const [x1, y1] = toWorld(b.right, b.bottom);
      return { x0, y0, x1, y1 };
    }));
  }

  // Janela de busca do Graph view. O texto continua filtrando a teia depois de fechar
  function openWebSearch() {
    webSearchPop.hidden = false;
    webSearch.focus();
    webSearch.select();
  }

  function closeWebSearch() {
    webSearchPop.hidden = true;
  }

  webSearchClose.addEventListener('click', closeWebSearch);

  // ⌘F no Mac, Alt+F nos outros sistemas: abre a busca só dentro do Graph view
  const IS_MAC = /Mac/i.test(navigator.userAgent);
  window.addEventListener('keydown', e => {
    if (!isWebMode() || e.key.toLowerCase() !== 'f' || e.shiftKey) return;
    const shortcut = IS_MAC ? e.metaKey && !e.altKey : e.altKey && !e.metaKey;
    if (!shortcut) return;
    e.preventDefault();
    openWebSearch();
  });

  function frame() {
    if (isWebMode()) {
      updateObstacles();
      sim?.settle(5); // a teia se acomoda aos poucos; quando estável, cada passo custa pouco
      drawWeb();
    }
    requestAnimationFrame(frame);
  }

  // Liga ou desliga o modo teia: o editor e a lista somem, e a teia ocupa a tela
  function setWebMode(on) {
    document.body.classList.toggle('web-mode', on);
    shiftFirst = null;
    pointerStart = null;
    if (on) {
      resizeWeb();
      centerWeb(DEFAULT_WEB_ZOOM); // ao abrir o Graph view: zoom padrão e teia centralizada
    } else {
      closeWebSearch();
    }
  }

  webToggle.addEventListener('click', () => {
    notesDialog.hidden = true; // a teia cobre a tela: a janela de notas fecha antes
    setWebMode(true);
  });
  webBack.addEventListener('click', () => setWebMode(false));

  // Shift + clique: a primeira nota é marcada, a segunda cria ou remove a ligação manual entre as duas
  async function pickForLink(name) {
    if (!shiftFirst) {
      shiftFirst = name;
      notify(`Shift+click another note to link with ${name}`);
      return;
    }
    const first = shiftFirst;
    shiftFirst = null;
    if (first === name) return;
    if (linksError) return notify(linksError, true);
    webLinks = Links.toggleLink(webLinks, first, name);
    const added = webLinks.some(pair => pair.includes(first) && pair.includes(name));
    if (await writeLinks()) notify(added ? `Linked ${first} and ${name}` : `Unlinked ${first} and ${name}`);
    rebuildSim();
  }

  window.addEventListener('pointerdown', e => {
    if (!isWebMode() || e.target.closest(WEB_SKIP)) return;
    if (e.button === 2) {
      // botão direito: segura e arrasta para mover a teia
      panning = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    if (e.button !== 0) return;
    const hit = nodeAt(e.clientX, e.clientY);
    if (!hit) return;
    pointerStart = { x: e.clientX, y: e.clientY, name: hit.name, shift: e.shiftKey, moved: false };
    if (!e.shiftKey) {
      sim.pinAt(hit.name, hit.x, hit.y);
      dragging = hit.name;
    }
  });

  window.addEventListener('pointermove', e => {
    if (panning) {
      view.x = panning.vx + (e.clientX - panning.x);
      view.y = panning.vy + (e.clientY - panning.y);
      return;
    }
    if (!pointerStart) return;
    if (Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 4) pointerStart.moved = true;
    if (dragging) {
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      sim.pinAt(dragging, wx, wy);
    }
  });

  window.addEventListener('pointerup', () => {
    if (panning) {
      panning = null;
      return;
    }
    if (!pointerStart) return;
    const { name, shift, moved } = pointerStart;
    pointerStart = null;
    if (dragging) {
      sim.release(dragging);
      dragging = null;
    }
    if (moved) return;
    selected = name;
    if (shift) return pickForLink(name);
    // clique simples abre a nota em janela de leitura, como o olho da lista; a teia continua aberta
    readNote(name);
  });

  // Zoom em torno de um ponto da tela (o centro, para o slider; o cursor, para a roda)
  function setZoom(next, cx = innerWidth / 2, cy = innerHeight / 2) {
    next = Math.min(4, Math.max(0.3, next));
    const ratio = next / view.scale;
    view.x = cx - (cx - view.x) * ratio;
    view.y = cy - (cy - view.y) * ratio;
    view.scale = next;
    showZoom();
  }

  // Mostra o zoom atual no slider e na porcentagem
  function showZoom() {
    webZoom.value = String(view.scale);
    webZoomValue.textContent = `${Math.round(view.scale * 100)}%`;
  }

  // Centraliza a teia na tela, com o zoom dado
  function centerWeb(scale = view.scale) {
    if (!sim || !sim.nodes.length) return;
    const xs = sim.nodes.map(n => n.x);
    const ys = sim.nodes.map(n => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    view.scale = Math.min(4, Math.max(0.3, scale));
    view.x = innerWidth / 2 - cx * view.scale;
    view.y = innerHeight / 2 - cy * view.scale;
    showZoom();
  }

  // fit to window: zoom que deixa todos os pontos visíveis na janela, centralizados
  function fitWeb() {
    if (!sim || !sim.nodes.length) return;
    const xs = sim.nodes.map(n => n.x);
    const ys = sim.nodes.map(n => n.y);
    const w = Math.max(Math.max(...xs) - Math.min(...xs), 1);
    const h = Math.max(Math.max(...ys) - Math.min(...ys), 1);
    centerWeb(Math.min((innerWidth * 0.9) / w, (innerHeight * 0.9) / h));
  }

  $('web-fit').addEventListener('click', fitWeb);

  // Roda do mouse: zoom centrado no cursor
  window.addEventListener('wheel', e => {
    if (!isWebMode() || !sim || e.target.closest(WEB_SKIP)) return;
    e.preventDefault();
    setZoom(view.scale * Math.exp(-e.deltaY * 0.001), e.clientX, e.clientY);
  }, { passive: false });

  // Slider vertical de zoom
  webZoom.addEventListener('input', () => setZoom(Number(webZoom.value)));

  // Na teia, o menu de contexto não aparece: o botão direito é para mover
  window.addEventListener('contextmenu', e => {
    if (isWebMode()) e.preventDefault();
  });

  // Apagar a nota selecionada na teia: tecla Delete, sem foco em campo de texto
  window.addEventListener('keydown', e => {
    if (!isWebMode() || e.key !== 'Delete' || !selected || e.target.closest(WEB_SKIP)) return;
    deleteNote(selected);
    selected = null;
  });

  window.addEventListener('resize', () => {
    resizeWeb();
    rebuildSim();
  });

  resizeWeb();
  requestAnimationFrame(frame);
  refresh();
  refreshSidebar();
  textarea.focus();
})();
