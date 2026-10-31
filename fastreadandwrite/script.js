// Busca local.
// Escolha de diretório: o botão de pasta abre o seletor do sistema e mostra quantos
// documentos (.md, .txt, .rtf) a pasta contém.
// Ao digitar, a busca encontra o texto no nome, no conteúdo ou nas tags (#tag)
// de cada documento e lista os arquivos correspondentes abaixo do campo.
// Ao clicar em um arquivo, ele abre em uma janela de leitura que pode ser editada.
// Arquivos criados pelo botão "novo arquivo" são salvos só dentro da pasta escolhida.

const folderBtn = document.getElementById("folder-btn");
const folderInput = document.getElementById("folder-input");
const fileCount = document.getElementById("file-count");
const searchInput = document.getElementById("search-input");
const results = document.getElementById("results");
const newBtn = document.getElementById("new-btn");

const docDialog = document.getElementById("doc-dialog");
const docTitle = document.getElementById("doc-title");
const docText = document.getElementById("doc-text");
const docToolbar = document.getElementById("doc-toolbar");
const docEditor = document.getElementById("doc-editor");
const docEdit = document.getElementById("doc-edit");
const docCancel = document.getElementById("doc-cancel");
const docSave = document.getElementById("doc-save");
const docClose = document.getElementById("doc-close");
const docFind = document.getElementById("doc-find");
const docFindCount = document.getElementById("doc-find-count");
const docFontDown = document.getElementById("doc-font-down");
const docFontUp = document.getElementById("doc-font-up");
const docFindRow = document.getElementById("doc-find-row");
const docProtect = document.getElementById("doc-protect");
const docEditTools = document.getElementById("doc-edit-tools");
const docLock = document.getElementById("doc-lock");
const docLockText = document.getElementById("doc-lock-text");
const docLockPass = document.getElementById("doc-lock-pass");
const docLockConfirm = document.getElementById("doc-lock-confirm");
const docLockError = document.getElementById("doc-lock-error");
const docLockSubmit = document.getElementById("doc-lock-submit");
const docLockCancel = document.getElementById("doc-lock-cancel");
const formatButtons = Array.from(document.querySelectorAll(".doc-dialog__format"));

const DOCUMENT_PATTERN = /\.(md|txt|rtf)$/i;
const RTF_PATTERN = /\.rtf$/i;
// Tag: "#" seguido de letras, números, "_" ou "-", no início do texto ou após espaço.
const TAG_PATTERN = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
// Única formatação permitida no texto editado.
const ALLOWED_TAGS = new Set(["B", "I", "U", "S", "STRIKE", "DEL", "BR", "DIV", "P"]);
const ALIGNMENT_PATTERN = /text-align:\s*(left|center|right|justify)/i;
const FONT_SIZE_PATTERN = /font-size:\s*(\d+(?:\.\d+)?)px/i;
const CAN_PICK_WRITABLE_FOLDER = typeof window.showDirectoryPicker === "function";
const CAN_SAVE_FILE = typeof window.showSaveFilePicker === "function";
// Primeira linha de um arquivo protegido por senha. O restante é o conteúdo cifrado.
const LOCK_MARKER = "INFO-PANEL-LOCK-V1";
const PBKDF2_ITERATIONS = 200000;

let lockMode = "unlock";

// Cada documento: { name, content (texto puro, usado na busca), html (texto formatado), text, tags, isNew, handle }
let documents = [];
// Arquivos criados e ainda não salvos na pasta.
let createdDocs = [];
// Pasta escolhida com permissão de escrita (null se não houver).
let rootHandle = null;
let loadToken = 0;
let currentDoc = null;

function allDocuments() {
  return [...documents, ...createdDocs];
}

// ---- Tema claro / escuro ----

const themeToggle = document.getElementById("theme-toggle");

themeToggle.addEventListener("click", () => {
  const isLight = document.documentElement.dataset.theme === "light";
  if (isLight) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = "light";
  }
  try {
    localStorage.setItem("theme", isLight ? "dark" : "light");
  } catch (error) {
    // Sem armazenamento: o tema vale só até recarregar a página.
  }
});

// ---- Escolha da pasta ----

folderBtn.addEventListener("click", async () => {
  if (!CAN_PICK_WRITABLE_FOLDER) {
    folderInput.click();
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const entries = await collectFromHandle(dirHandle);
    await loadFolder(dirHandle.name, entries, dirHandle);
  } catch (error) {
    if (error.name !== "AbortError") {
      alert("Não foi possível abrir a pasta escolhida.");
    }
  }
});

folderInput.addEventListener("change", async () => {
  const files = Array.from(folderInput.files || []);
  if (files.length === 0) return;

  // O caminho relativo de cada arquivo começa pelo nome da pasta escolhida.
  const folderName = files[0].webkitRelativePath.split("/")[0];
  const entries = files
    .filter((file) => DOCUMENT_PATTERN.test(file.name))
    .map((file) => ({
      file,
      handle: null,
      // Caminho dentro da pasta escolhida, sem o nome da própria pasta.
      path: file.webkitRelativePath.split("/").slice(1).join("/"),
    }));
  // Sem permissão de escrita neste navegador: a pasta é só para leitura.
  await loadFolder(folderName, entries, null);
});

// Percorre a pasta e as subpastas e devolve os documentos suportados.
async function collectFromHandle(dirHandle, prefix = "") {
  const found = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === "directory") {
      found.push(...(await collectFromHandle(entry, `${prefix}${entry.name}/`)));
    } else if (DOCUMENT_PATTERN.test(entry.name)) {
      found.push({ file: await entry.getFile(), handle: entry, path: `${prefix}${entry.name}` });
    }
  }
  return found;
}

async function loadFolder(folderName, entries, dirHandle) {
  rootHandle = dirHandle;
  folderBtn.setAttribute("aria-label", `Diretório escolhido: ${folderName}`);
  folderBtn.title = folderName;

  const total = entries.length;
  fileCount.textContent = total === 1
    ? "1 arquivo"
    : `${total.toLocaleString("pt-BR")} arquivos`;
  fileCount.hidden = false;

  // Lê o conteúdo de cada documento. O token evita resultados de uma escolha antiga.
  const token = ++loadToken;
  const loaded = await Promise.all(entries.map(async ({ file, handle, path }) => ({
    ...(await readDocument(file)),
    handle,
    path,
  })));
  if (token !== loadToken) return;

  documents = loaded;
  renderResults(searchInput.value);
}

searchInput.addEventListener("input", () => {
  renderResults(searchInput.value);
});

// ---- Criação de arquivos ----

newBtn.addEventListener("click", () => {
  const doc = {
    name: uniqueName("Novo arquivo", ".txt"),
    html: "",
    handle: null,
    isNew: true,
    ...indexText(""),
  };
  createdDocs.push(doc);
  renderResults(searchInput.value);
  openDocument(doc);
  startEditing();
});

// Gera um nome que não existe ainda: "Novo arquivo.txt", "Novo arquivo 2.txt", ...
function uniqueName(base, extension) {
  const taken = new Set(allDocuments().map((doc) => doc.name));
  let name = `${base}${extension}`;
  for (let n = 2; taken.has(name); n++) {
    name = `${base} ${n}${extension}`;
  }
  return name;
}

// Pergunta onde salvar (janela do sistema com pasta e nome) e grava o arquivo novo.
async function saveNewDocument(doc, text) {
  if (!CAN_SAVE_FILE) {
    alert("Este navegador não permite salvar arquivos. Use o Chrome ou o Edge.");
    return false;
  }

  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: doc.name,
      startIn: rootHandle || "documents",
      types: [{ description: "Texto", accept: { "text/plain": [".txt"] } }],
    });
  } catch (error) {
    // Cancelado pela pessoa: o arquivo continua aberto e não salvo.
    return false;
  }

  const payload = doc.password ? await encryptText(text, doc.password) : text;
  const writable = await handle.createWritable();
  await writable.write(payload);
  await writable.close();

  doc.name = handle.name;
  doc.handle = handle;
  doc.isNew = false;
  createdDocs = createdDocs.filter((item) => item !== doc);
  documents.push(doc);
  return true;
}

// ---- Leitura e busca ----

async function readDocument(file) {
  const raw = await file.text();
  if (raw.startsWith(LOCK_MARKER)) {
    // Protegido: o conteúdo só é lido depois de informar a senha.
    return { name: file.name, locked: true, envelope: raw, html: "", isNew: false, ...indexText("") };
  }
  const plain = RTF_PATTERN.test(file.name) ? stripRtf(raw) : raw;
  return { name: file.name, locked: false, html: textToHtml(plain), isNew: false, ...indexText(plain) };
}

// ---- Proteção por senha (AES-GCM, chave derivada com PBKDF2) ----

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptText(plain, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain)
  );
  const payload = JSON.stringify({
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(encrypted)),
  });
  return `${LOCK_MARKER}\n${payload}`;
}

// Lança erro se a senha estiver errada (a verificação do AES-GCM falha).
async function decryptText(envelope, password) {
  const { salt, iv, data } = JSON.parse(envelope.slice(LOCK_MARKER.length).trim());
  const key = await deriveKey(password, fromBase64(salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    key,
    fromBase64(data)
  );
  return new TextDecoder().decode(decrypted);
}

// Grava o conteúdo no arquivo de origem, cifrado se houver senha.
async function writeDocument(doc, plain) {
  const payload = doc.password ? await encryptText(plain, doc.password) : plain;
  const writable = await doc.handle.createWritable();
  await writable.write(payload);
  await writable.close();
}

// Gera o texto puro, a versão para busca e as tags de um conteúdo.
function indexText(plain) {
  const tags = Array.from(plain.matchAll(TAG_PATTERN), (match) => `#${match[1]}`.toLowerCase());
  return {
    content: plain,
    text: plain.toLowerCase(),
    tags: [...new Set(tags)],
  };
}

// Remove comandos e chaves de RTF, deixando só o texto visível (aproximação simples).
function stripRtf(raw) {
  return raw
    .replace(/\\[a-z]+-?\d* ?/gi, " ")
    .replace(/\\[^a-z]/gi, " ")
    .replace(/[{}]/g, " ");
}

function textToHtml(plain) {
  const holder = document.createElement("div");
  holder.textContent = plain;
  return holder.innerHTML;
}

// Mantém só as tags de formatação permitidas, sem atributos,
// exceto o alinhamento do texto (text-align) em blocos.
function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  cleanNode(template.content);
  return template.innerHTML;
}

function cleanNode(parent) {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove();
      continue;
    }
    cleanNode(node);
    const style = node.getAttribute("style") || "";
    const alignment = style.match(ALIGNMENT_PATTERN);
    const fontSize = style.match(FONT_SIZE_PATTERN);

    // <span> só é mantido quando guarda um tamanho de fonte.
    const keep = ALLOWED_TAGS.has(node.tagName) || (node.tagName === "SPAN" && fontSize);
    if (!keep) {
      node.replaceWith(...node.childNodes);
      continue;
    }

    for (const attr of Array.from(node.attributes)) {
      node.removeAttribute(attr.name);
    }
    if (alignment) {
      node.setAttribute("style", `text-align: ${alignment[1].toLowerCase()}`);
    } else if (fontSize) {
      node.setAttribute("style", `font-size: ${fontSize[1]}px`);
    }
  }
}

function matchesDocument(doc, term) {
  return (
    (doc.path || doc.name).toLowerCase().includes(term) ||
    doc.text.includes(term) ||
    doc.tags.some((tag) => tag.includes(term))
  );
}

function renderResults(query) {
  const term = query.trim().toLowerCase();
  results.replaceChildren();

  if (term === "" || allDocuments().length === 0) {
    results.hidden = true;
    return;
  }

  const matches = allDocuments().filter((doc) => matchesDocument(doc, term));

  if (matches.length === 0) {
    const empty = document.createElement("li");
    empty.className = "is-empty";
    empty.textContent = "Nenhum arquivo encontrado";
    results.append(empty);
  } else {
    for (const doc of matches) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "results__item";
      const name = document.createElement("span");
      name.className = "results__name";
      name.textContent = doc.name;
      button.append(name);

      // Mostra a subpasta onde o arquivo está, quando houver.
      const path = doc.path || "";
      const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (folder) {
        const location = document.createElement("span");
        location.className = "results__path";
        location.textContent = folder;
        button.append(location);
      }
      button.addEventListener("click", () => openDocument(doc));
      item.append(button);
      results.append(item);
    }
  }

  results.hidden = false;
}

// ---- Janela de leitura / edição ----

function openDocument(doc) {
  currentDoc = doc;
  docTitle.textContent = doc.name;
  docFind.value = "";
  if (doc.locked) {
    showLockPanel("unlock");
  } else {
    showReading();
  }
  if (!docDialog.open) {
    docDialog.showModal();
  }
}

function showReading() {
  docLock.hidden = true;
  docFindRow.hidden = false;
  if (currentDoc.content.trim() === "") {
    docText.textContent = "Arquivo vazio.";
  } else {
    docText.innerHTML = currentDoc.html;
  }
  docText.hidden = false;
  docToolbar.hidden = false;
  docEditTools.hidden = true;
  docEditor.hidden = true;
  docEdit.hidden = false;
  docCancel.hidden = true;
  docSave.hidden = true;
  updateLockButton();
  applyFind();
}

// Cadeado: aberto se o arquivo não tem senha, fechado se tem.
function updateLockButton() {
  const isLocked = Boolean(currentDoc.password);
  docProtect.classList.toggle("is-locked", isLocked);
  const label = isLocked ? "Alterar senha" : "Proteger com senha";
  docProtect.title = label;
  docProtect.setAttribute("aria-label", label);
}

function startEditing() {
  docEditor.innerHTML = currentDoc.html;
  docText.hidden = true;
  docToolbar.hidden = false;
  docEditTools.hidden = false;
  docEditor.hidden = false;
  docEdit.hidden = true;
  docCancel.hidden = false;
  docSave.hidden = false;
  docEditor.focus();
  updateFormatState();
  applyFind();
}

// ---- Painel de senha (definir ou informar) ----

function showLockPanel(mode) {
  lockMode = mode;
  const isSetting = mode === "set";

  docLock.hidden = false;
  docFindRow.hidden = true;
  docText.hidden = true;
  docEditor.hidden = true;
  docToolbar.hidden = true;
  docEdit.hidden = true;
  docCancel.hidden = true;
  docSave.hidden = true;

  docLockPass.value = "";
  docLockConfirm.value = "";
  docLockConfirm.hidden = !isSetting;
  docLockError.textContent = "";
  docLockText.textContent = isSetting
    ? "Digite uma senha para proteger este arquivo. Sem ela, o conteúdo não poderá ser lido."
    : "Este arquivo está protegido. Digite a senha para ler.";
  docLockSubmit.textContent = isSetting ? "Proteger" : "Abrir";
  docLockCancel.textContent = isSetting ? "Cancelar" : "Fechar";
  docLockPass.focus();
}

docProtect.addEventListener("click", () => {
  // Abrir o painel de senha fecha o editor; edições não salvas seriam perdidas.
  if (!docEditor.hidden && !window.confirm("Descartar as alterações não salvas para proteger o arquivo?")) {
    return;
  }
  showLockPanel("set");
});

docLockCancel.addEventListener("click", () => {
  if (lockMode === "unlock") {
    docDialog.close();
  } else {
    showReading();
  }
});

docLock.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = docLockPass.value;
  if (password.length === 0) {
    docLockError.textContent = "Digite uma senha.";
    return;
  }
  if (lockMode === "unlock") {
    await unlockDocument(password);
  } else {
    if (password !== docLockConfirm.value) {
      docLockError.textContent = "As senhas não coincidem.";
      return;
    }
    await protectDocument(password);
  }
});

async function unlockDocument(password) {
  let plain;
  try {
    plain = await decryptText(currentDoc.envelope, password);
  } catch (error) {
    docLockError.textContent = "Senha incorreta.";
    return;
  }
  Object.assign(currentDoc, indexText(plain), {
    html: textToHtml(plain),
    password,
    locked: false,
    envelope: null,
  });
  renderResults(searchInput.value);
  showReading();
}

async function protectDocument(password) {
  if (!currentDoc.isNew && !currentDoc.handle) {
    docLockError.textContent =
      "Esta pasta é só para leitura. Escolha a pasta com o Chrome ou o Edge para proteger arquivos.";
    return;
  }

  const previous = currentDoc.password;
  currentDoc.password = password;
  // Arquivo novo: a senha vale no próximo "Salvar". Arquivo da pasta: grava já cifrado.
  if (!currentDoc.isNew) {
    try {
      await writeDocument(currentDoc, currentDoc.content);
    } catch (error) {
      currentDoc.password = previous;
      docLockError.textContent = "Não foi possível gravar o arquivo.";
      return;
    }
  }
  showReading();
}

// ---- Busca dentro do arquivo aberto ----

let findHits = [];
let findIndex = -1;

function activeTextRoot() {
  return docEditor.hidden ? docText : docEditor;
}

// Remove os destaques anteriores e junta os textos de volta.
function clearFindHighlights(root) {
  for (const mark of Array.from(root.querySelectorAll("mark.doc-find__hit"))) {
    mark.replaceWith(...mark.childNodes);
  }
  root.normalize();
}

// Destaca todas as ocorrências do termo (sem diferenciar maiúsculas) e mostra a contagem.
function applyFind() {
  const root = activeTextRoot();
  clearFindHighlights(root);
  findHits = [];
  findIndex = -1;

  const term = docFind.value;
  if (term.length > 0) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    const needle = term.toLowerCase();
    for (const node of textNodes) {
      const text = node.nodeValue;
      const haystack = text.toLowerCase();
      let index = haystack.indexOf(needle);
      if (index === -1) continue;

      const fragment = document.createDocumentFragment();
      let last = 0;
      while (index !== -1) {
        fragment.append(text.slice(last, index));
        const mark = document.createElement("mark");
        mark.className = "doc-find__hit";
        mark.textContent = text.slice(index, index + term.length);
        fragment.append(mark);
        findHits.push(mark);
        last = index + term.length;
        index = haystack.indexOf(needle, last);
      }
      fragment.append(text.slice(last));
      node.replaceWith(fragment);
    }
  }

  moveToHit(true);
}

// Vai para a próxima (ou anterior) ocorrência e a centraliza na tela.
function moveToHit(forward) {
  if (findHits.length === 0) {
    updateFindCount();
    return;
  }
  if (findIndex >= 0) {
    findHits[findIndex].classList.remove("is-current");
  }
  const total = findHits.length;
  findIndex = findIndex === -1
    ? 0
    : (findIndex + (forward ? 1 : -1) + total) % total;

  const hit = findHits[findIndex];
  hit.classList.add("is-current");
  hit.scrollIntoView({ block: "center" });
  updateFindCount();
}

function updateFindCount() {
  if (docFind.value.length === 0) {
    docFindCount.textContent = "";
  } else if (findHits.length === 0) {
    docFindCount.textContent = "Nenhum resultado";
  } else {
    docFindCount.textContent = `${findIndex + 1} de ${findHits.length}`;
  }
}

docFind.addEventListener("input", applyFind);
docFind.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    moveToHit(!event.shiftKey);
  }
});

async function saveEdit() {
  const html = sanitizeHtml(docEditor.innerHTML);
  const plain = docEditor.innerText;
  Object.assign(currentDoc, indexText(plain), { html });

  // Arquivo novo: só é considerado salvo quando gravado na pasta escolhida.
  // Arquivos já existentes: a alteração fica na memória da página, sem gravar no disco.
  if (currentDoc.isNew) {
    const saved = await saveNewDocument(currentDoc, plain);
    if (!saved) return;
  } else if (currentDoc.password && currentDoc.handle) {
    // Arquivo protegido da pasta: a alteração é gravada já cifrada.
    try {
      await writeDocument(currentDoc, plain);
    } catch (error) {
      alert("Não foi possível gravar o arquivo protegido.");
      return;
    }
  }

  showReading();
  renderResults(searchInput.value);
}

// Estado dos botões de formatação segundo o trecho selecionado.
function updateFormatState() {
  if (docEditor.hidden) return;
  for (const button of formatButtons) {
    const active = document.queryCommandState(button.dataset.command);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

docEdit.addEventListener("click", startEditing);
docCancel.addEventListener("click", showReading);
docSave.addEventListener("click", saveEdit);

// Mantém a seleção do texto ao clicar nos botões de formatação.
docToolbar.addEventListener("mousedown", (event) => {
  if (event.target.closest(".doc-dialog__format")) {
    event.preventDefault();
  }
});

docToolbar.addEventListener("click", (event) => {
  const button = event.target.closest(".doc-dialog__format");
  if (!button) return;
  docEditor.focus();
  document.execCommand(button.dataset.command);
  updateFormatState();
});

// ---- Tamanho da fonte do texto editado ----

const docFontSizeSelect = document.getElementById("doc-font-size");
let savedSelection = null;

// Guarda o trecho selecionado dentro do editor, pois o select tira o foco ao ser aberto.
document.addEventListener("selectionchange", () => {
  const selection = window.getSelection();
  if (selection.rangeCount > 0 && docEditor.contains(selection.anchorNode)) {
    savedSelection = selection.getRangeAt(0).cloneRange();
  }
});

docFontSizeSelect.addEventListener("change", () => {
  const size = docFontSizeSelect.value;
  if (!savedSelection) return;

  docEditor.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedSelection);

  // Marca o trecho com um tamanho provisório e troca por <span> com o tamanho exato.
  document.execCommand("fontSize", false, "7");
  for (const font of Array.from(docEditor.querySelectorAll('font[size="7"]'))) {
    const span = document.createElement("span");
    span.style.fontSize = `${size}px`;
    span.append(...font.childNodes);
    font.replaceWith(span);
  }
  savedSelection = null;
});

docEditor.addEventListener("keyup", updateFormatState);
docEditor.addEventListener("mouseup", updateFormatState);
document.addEventListener("selectionchange", updateFormatState);

docEditor.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveEdit();
  }
});

docClose.addEventListener("click", () => {
  docDialog.close();
});

// ---- Tamanho da fonte na janela de leitura ----

const DOC_FONT_MIN = 11;
const DOC_FONT_MAX = 28;
let docFontSize = 15;

function setDocFontSize(size) {
  docFontSize = Math.min(DOC_FONT_MAX, Math.max(DOC_FONT_MIN, size));
  docDialog.style.setProperty("--doc-font-size", `${docFontSize}px`);
  docFontDown.disabled = docFontSize <= DOC_FONT_MIN;
  docFontUp.disabled = docFontSize >= DOC_FONT_MAX;
}

// O tamanho escolhido vale para todos os arquivos abertos nesta sessão.
docFontDown.addEventListener("click", () => setDocFontSize(docFontSize - 1));
docFontUp.addEventListener("click", () => setDocFontSize(docFontSize + 1));
setDocFontSize(docFontSize);
