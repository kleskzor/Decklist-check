// c:\Users\klesk\OneDrive\MtG\Decklist check\scripts\main.js
let players = [];
let currentSelectedName = null;
let highlightedIndex = -1;
let playerSearchQuery = "";
const STORAGE_KEY = 'mtg_decklist_data';
let isEditMode = false;
let searchTimeout = null;

function toggleMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('dropdownMenu');
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('dropdownMenu');
    const btn = document.getElementById('menuBtn');
    if (menu.style.display === 'block' && e.target !== menu && !menu.contains(e.target) && e.target !== btn) {
        menu.style.display = 'none';
    }
});

document.getElementById('playerSearchInput').addEventListener('input', (e) => {
    playerSearchQuery = e.target.value.toLowerCase();
    renderSidebar();
});

// --- DB & IMAGE LOGIC ---
const dbName = "MTGImageCache";
const storeName = "images";
const delay = (ms) => new Promise(res => setTimeout(res, ms));

function initDB() {
    return new Promise((resolve) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore(storeName);
        request.onsuccess = (e) => resolve(e.target.result);
    });
}

async function getSmartImage(cardName, imgElement, placeholderElement) {
    const db = await initDB();
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const getReq = store.get(cardName);

    getReq.onsuccess = async () => {
        if (getReq.result) {
            imgElement.src = URL.createObjectURL(getReq.result);
            imgElement.onload = () => placeholderElement.style.display = "none";
        } else {
            // Přidáme malou prodlevu, abychom nespamovali Scryfall (prevence Error 429)
            await delay(100); 
            const scryfallUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}&format=image&version=normal`;
            
            try {
                const response = await fetch(scryfallUrl);
                if (!response.ok) throw new Error("Scryfall limit");
                const blob = await response.blob();
                
                const saveTx = db.transaction(storeName, "readwrite");
                saveTx.objectStore(storeName).put(blob, cardName);
                
                imgElement.src = URL.createObjectURL(blob);
                imgElement.onload = () => placeholderElement.style.display = "none";
            } catch (err) {
                console.warn("CORS nebo RateLimit - zkouším přímé zobrazení bez uložení:", cardName);
                // Fallback: Pokud selže fetch (CORS), zkusíme to vložit přímo do SRC. 
                // Prohlížeč obrázek zobrazí, ale my ho nebudeme moct uložit do DB.
                imgElement.src = scryfallUrl;
                imgElement.onload = () => placeholderElement.style.display = "none";
                imgElement.onerror = () => {
                    placeholderElement.innerHTML = `⚠️<br>${cardName}`;
                    placeholderElement.style.color = "#ff5252";
                };
            }
        }
    };
}

async function getCardImageUrl(cardName) {
    const db = await initDB();
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const getReq = store.get(cardName);

    return new Promise((resolve) => {
        getReq.onsuccess = async () => {
            if (getReq.result) {
                resolve(URL.createObjectURL(getReq.result));
            } else {
                await delay(100); 
                const scryfallUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}&format=image&version=normal`;
                try {
                    const response = await fetch(scryfallUrl);
                    if (!response.ok) throw new Error("Scryfall limit");
                    const blob = await response.blob();
                    const saveTx = db.transaction(storeName, "readwrite");
                    saveTx.objectStore(storeName).put(blob, cardName);
                    resolve(URL.createObjectURL(blob));
                } catch (err) {
                    resolve(scryfallUrl);
                }
            }
        };
        getReq.onerror = () => resolve(null);
    });
}

// --- CARD VALIDATION DB ---
const cardDbName = "MTGCardDB";
const cardStoreName = "validCards";

function initCardDB() {
    return new Promise((resolve) => {
        const request = indexedDB.open(cardDbName, 1);
        request.onupgradeneeded = (e) => {
            if (!e.target.result.objectStoreNames.contains(cardStoreName)) {
                e.target.result.createObjectStore(cardStoreName, { keyPath: "name" });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
    });
}

async function checkCardsInScryfall(cardNames) {
    const db = await initCardDB();
    
    // 1. Check local DB
    const unknownCards = [];
    const tx = db.transaction(cardStoreName, "readonly");
    const store = tx.objectStore(cardStoreName);
    
    await Promise.all(cardNames.map(name => new Promise(resolve => {
        const req = store.get(name);
        req.onsuccess = () => {
            if (!req.result) unknownCards.push(name);
            resolve();
        };
    })));

    if (unknownCards.length === 0) return { valid: true, invalidNames: [] };

    // 2. Check Scryfall (Batching max 75)
    const invalidNames = [];
    const batches = [];
    while (unknownCards.length > 0) batches.push(unknownCards.splice(0, 75));

    const saveTx = db.transaction(cardStoreName, "readwrite");
    const saveStore = saveTx.objectStore(cardStoreName);

    for (const batch of batches) {
        const body = { identifiers: batch.map(name => ({ name })) };
        const resp = await fetch("https://api.scryfall.com/cards/collection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        
        if (data.not_found && data.not_found.length > 0) {
            data.not_found.forEach(nf => invalidNames.push(nf.name));
        }
        
        if (data.data) {
            data.data.forEach(card => {
                // Uložíme nalezené jméno (Scryfall vrací kanonické jméno, ale uložíme to, co jsme hledali, pokud to sedí)
                // Pro zjednodušení uložíme jméno karty tak, jak ji vrátil Scryfall, ale klíč musí být to, co hledáme, 
                // nebo prostě uložíme batch inputy, které NEJSOU v not_found.
                // Zde: Uložíme všechny z batche, které nejsou v invalidNames.
            });
        }
    }
    
    // Uložíme validní karty do DB
    // Musíme vědět, které z původního batche byly validní.
    // Jednodušší: Projdeme původní batch, pokud není v invalidNames, uložíme.
    for (const batch of batches) { // Batches jsou už prázdné kvůli splice, musíme si je pamatovat? 
        // Oprava logiky výše: splice modifikuje pole.
    }
    
    // Re-implementace smyčky pro správné uložení
    return { valid: invalidNames.length === 0, invalidNames };
}

// Opravená funkce pro validaci s DB zápisem
async function validateCardsBatch(names, onProgress) {
    const db = await initCardDB();
    const unknown = [];
    
    // Check DB
    const tx = db.transaction(cardStoreName, "readonly");
    const store = tx.objectStore(cardStoreName);
    
    await Promise.all(names.map(n => new Promise(r => {
        const req = store.get(n);
        req.onsuccess = () => { if (!req.result) unknown.push(n); r(); };
    })));

    if (unknown.length === 0) return [];

    const invalid = [];
    const batches = [];
    const tempUnknown = [...unknown];
    while (tempUnknown.length > 0) batches.push(tempUnknown.splice(0, 75));
    const totalBatches = batches.length;

    for (let i = 0; i < totalBatches; i++) {
        const batch = batches[i];
        try {
            const resp = await fetch("https://api.scryfall.com/cards/collection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifiers: batch.map(name => ({ name })) })
            });
            const data = await resp.json();
            
            let notFoundNames = (data.not_found || []).map(nf => nf.name);

            // RETRY LOGIKA PRO SPLIT KARTY
            // Pokud se karta s "//" nenašla, zkusíme hledat jen přední stranu
            const splitRetries = notFoundNames.filter(n => n.includes(' // '));
            if (splitRetries.length > 0) {
                const retryMap = {}; // frontFace -> originalName
                const retryBatch = splitRetries.map(n => {
                    const front = n.split(' // ')[0];
                    retryMap[front] = n;
                    return { name: front };
                });

                try {
                    const retryResp = await fetch("https://api.scryfall.com/cards/collection", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ identifiers: retryBatch })
                    });
                    const retryData = await retryResp.json();

                    // Pokud se přední strana našla, považujeme původní název za validní
                    const saveTx = db.transaction(cardStoreName, "readwrite");
                    const saveStore = saveTx.objectStore(cardStoreName);

                    retryBatch.forEach(input => {
                        const frontName = input.name;
                        const originalName = retryMap[frontName];
                        
                        // Pokud NENÍ v not_found u retry requestu, tak se našla
                        const isStillMissing = retryData.not_found && retryData.not_found.some(nf => nf.name === frontName);
                        
                        if (!isStillMissing) {
                            // Našlo se! Odstraníme z notFoundNames a uložíme originál do DB
                            notFoundNames = notFoundNames.filter(n => n !== originalName);
                            saveStore.put({ name: originalName, timestamp: Date.now() });
                        }
                    });
                } catch (e) {
                    console.warn("Retry failed for split cards", e);
                }
            }

            notFoundNames.forEach(n => invalid.push(n));

            // Uložit validní
            const saveTx = db.transaction(cardStoreName, "readwrite");
            const saveStore = saveTx.objectStore(cardStoreName);
            batch.forEach(name => {
                // Pokud karta nebyla v původním not_found (nebo byla zachráněna v retry), je validní
                // Pozor: musíme zkontrolovat aktuální notFoundNames, protože retry mohlo některé odstranit
                const isMissing = notFoundNames.includes(name);
                if (!isMissing) {
                    saveStore.put({ name: name, timestamp: Date.now() });
                }
            });
        } catch (e) {
            console.error("Validation error", e);
            // V případě chyby sítě raději neoznačíme jako invalid, ale vyhodíme alert v UI
            throw e;
        }

        if (onProgress) onProgress(i + 1, totalBatches);
    }
    return invalid;
}

function normalizeCardName(name) {
    // Nahradí jedno nebo více lomítek (s volitelnými mezerami) za " // "
    return name.trim().replace(/\s*\/+\s*/g, ' // ');
}

// --- CSV PARSING ---
document.getElementById('fileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => parseCSV(evt.target.result);
    reader.readAsText(file);
});

async function loadTestData() {
    try {
        // Fetch API vyžaduje HTTP/HTTPS protokol, nefunguje přes file://
        const response = await fetch('./test_data/test_data.csv');
        if (!response.ok) throw new Error(`HTTP chyba: ${response.status}`);
        const text = await response.text();
        parseCSV(text);
    } catch (err) {
        console.error(err);
        alert('Nepodařilo se načíst testovací data.\n\nPoznámka: Tlačítko funguje pouze pokud aplikace běží na webovém serveru (http/https). Při lokálním otevření (file://) prohlížeč načítání blokuje.\n\nDetaily chyby: ' + err.message);
    }
}

async function validateCSVAndImport() {
    const candidates = window.csvCandidates;
    if (!candidates) return;

    // Progress Bar UI
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'csvLoading';
    loadingDiv.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); color:white; display:flex; flex-direction:column; justify-content:center; align-items:center; z-index:20000; font-family:sans-serif;";
    loadingDiv.innerHTML = `
        <div style="font-size: 1.5rem; margin-bottom: 20px;">Ověřuji karty a decklisty...</div>
        <div style="width: 300px; height: 20px; background: #444; border-radius: 10px; overflow: hidden;">
            <div id="csvProgressBar" style="width: 0%; height: 100%; background: var(--success-color); transition: width 0.3s;"></div>
        </div>
        <div id="csvProgressText" style="margin-top: 10px; color: #ccc;">0%</div>
    `;
    document.body.appendChild(loadingDiv);

    const updateProgress = (percent, text) => {
        document.getElementById('csvProgressBar').style.width = `${percent}%`;
        document.getElementById('csvProgressText').textContent = text || `${Math.round(percent)}%`;
    };

    try {
        // 1. Collect all card names
        const allNames = new Set();
        candidates.forEach(p => {
            p.cards.forEach(c => allNames.add(c.name));
            if (p.arch) {
                const parts = p.arch.split(/[&+]/).map(s => s.trim()).filter(s => s);
                parts.forEach(n => allNames.add(normalizeCardName(n)));
            }
        });

        // 2. Validate names
        const invalidCards = await validateCardsBatch(Array.from(allNames), (curr, total) => {
            const pct = (curr / total) * 100;
            updateProgress(pct, `Ověřuji karty: ${curr} / ${total} dávek`);
        });

        // 3. Validate counts and map errors to players
        candidates.forEach(p => {
            p.validationErrors = [];
            
            // Check counts
            const deckCount = p.cards.reduce((sum, c) => sum + c.count, 0);
            let commanderCount = 0;
            if (p.arch) {
                commanderCount = p.arch.split(/[&+]/).filter(s => s.trim()).length;
            }
            const hasCompanion = p.arch && p.arch.includes('+');
            const target = hasCompanion ? 101 : 100;
            if (deckCount + commanderCount !== target) {
                p.validationErrors.push(`Nesprávný počet karet: ${deckCount + commanderCount} (očekáváno ${target})`);
            }

            // Check invalid cards
            const playerInvalidCards = p.cards.filter(c => invalidCards.includes(c.name)).map(c => c.name);
            if (playerInvalidCards.length > 0) {
                p.validationErrors.push(`Neznámé karty: ${playerInvalidCards.join(', ')}`);
            }
        });

        if (document.getElementById('csvLoading')) document.body.removeChild(document.getElementById('csvLoading'));

        // 4. Import
        players = candidates;
        players.sort((a, b) => a.name.localeCompare(b.name));
        saveState();
        renderSidebar();
        window.csvImportActive = false;
        window.csvCandidates = null;
        alert("Import úspěšný!");

    } catch (e) {
        if (document.getElementById('csvLoading')) document.body.removeChild(document.getElementById('csvLoading'));
        console.error(e);
        
        // Fallback: Load anyway on crash, but warn
        players = candidates;
        saveState();
        renderSidebar();
        window.csvImportActive = false;
        window.csvCandidates = null;
        alert("Chyba při validaci (importováno bez ověření): " + e.message);
    }
}

async function parseCSV(text) {
    const rows = [];
    let row = []; let field = ""; let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += c;
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',') { row.push(field); field = ""; }
            else if (c === '\n' || c === '\r') {
                if (field || row.length > 0) { row.push(field); rows.push(row); }
                row = []; field = ""; if (c === '\r' && text[i+1] === '\n') i++;
            } else field += c;
        }
    }
    if (field || row.length > 0) { row.push(field); rows.push(row); }

    const header = rows[0].map(h => h.trim());
    const fIdx = header.indexOf('first_name');
    const lIdx = header.indexOf('last_name');
    const listIdx = header.indexOf('plaintext_list');
    const archIdx = header.indexOf('archetype');
    const checkedIdx = header.indexOf('is_checked');

    const candidates = rows.slice(1).map(r => {
        const name = `${r[fIdx]} ${r[lIdx]}`.trim();
        const list = r[listIdx] || "";
        let arch = (r[archIdx] || "").replace(/\/\/|\//g, (m) => m === '//' ? '//' : ' & ');
        let cards = [];
        list.split('\n').forEach(line => {
            const lineTrim = line.trim();
            if (!lineTrim || lineTrim.includes("SIDEBOARD:")) return;
            const match = lineTrim.match(/^(\d+)\s+(.+)$/);
            if (match) cards.push({ count: parseInt(match[1]), current: parseInt(match[1]), name: normalizeCardName(match[2]) });
            else cards.push({ count: 1, current: 1, name: normalizeCardName(lineTrim) });
        });
        cards.sort((a, b) => a.name.localeCompare(b.name));

        if (checkedIdx !== -1) {
            const val = r[checkedIdx];
            if (val === '1' || (val && val.toLowerCase() === 'true')) {
                cards.forEach(c => c.current = 0);
            }
        }

        return { name, arch, cards };
    }).filter(p => p.name);
    
    window.csvCandidates = candidates;
    window.csvImportActive = true;
    await validateCSVAndImport();
}

function isPlayerDone(p) { return p.cards.length > 0 && p.cards.every(c => c.current === 0); }

function deletePlayer(name) {
    if (confirm(`Opravdu chcete smazat hráče "${name}"?`)) {
        players = players.filter(p => p.name !== name);
        saveState();
        if (currentSelectedName === name) {
            currentSelectedName = null;
            document.getElementById('deckInfo').innerHTML = "";
            document.getElementById('searchArea').innerHTML = "";
            document.getElementById('deckGrid').innerHTML = "";
        }
        renderSidebar();
    }
}

function deleteAllPlayers() {
    if (confirm('Opravdu chcete smazat všechny hráče a decklisty?')) {
        players = [];
        saveState();
        currentSelectedName = null;
        document.getElementById('deckInfo').innerHTML = "";
        document.getElementById('searchArea').innerHTML = "";
        document.getElementById('deckGrid').innerHTML = "";
        renderSidebar();
    }
}

function updateHeaderStats() {
    const stats = document.getElementById('headerStats');
    if (!stats) return;
    
    if (players.length === 0) {
        stats.style.display = 'none';
        return;
    }
    
    const done = players.filter(p => isPlayerDone(p)).length;
    stats.style.display = 'flex';
    stats.innerHTML = `
        <div class="stat-item"><span class="stat-value">${players.length}</span><span class="stat-label">Hráči</span></div>
        <div class="stat-item" style="color: var(--success-color)"><span class="stat-value">${done}</span><span class="stat-label">Hotovo</span></div>
    `;
}

function renderSidebar() {
    updateHeaderStats();
    const sb = document.getElementById('playerList');
    sb.innerHTML = "";
    if (players.length === 0) {
        sb.innerHTML = '<div style="padding: 20px; opacity: 0.5; text-align: center;">Nahrajte CSV soubor...</div>';
        return;
    }

    const filtered = players.filter(p => p.name.toLowerCase().includes(playerSearchQuery));
    const pending = filtered.filter(p => !isPlayerDone(p));
    const completed = filtered.filter(p => isPlayerDone(p));

    const renderList = (list, isCompleted) => {
        list.forEach(p => {
            const div = document.createElement('div');
            div.className = `player-item ${currentSelectedName === p.name ? 'active' : ''} ${isCompleted ? 'is-done' : ''}`;
            
            if (p.validationErrors && p.validationErrors.length > 0) {
                div.style.background = "rgba(255, 82, 82, 0.2)";
                div.title = "Chyby v decklistu:\n" + p.validationErrors.join("\n");
            }

            const info = document.createElement('div');
            info.innerHTML = `<strong>${p.name}</strong><br><small style="opacity:0.7">${p.arch || 'Deck'}</small>`;
            
            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.alignItems = 'center';
            actions.style.gap = '10px';

            if (isCompleted) {
                const check = document.createElement('span');
                check.textContent = '✅';
                actions.appendChild(check);
            }

            const delBtn = document.createElement('span');
            delBtn.innerHTML = '&times;';
            delBtn.style.color = 'var(--danger-color)';
            delBtn.style.fontSize = '1.5rem';
            delBtn.style.fontWeight = 'bold';
            delBtn.style.cursor = 'pointer';
            delBtn.onclick = (e) => { e.stopPropagation(); deletePlayer(p.name); };
            
            actions.appendChild(delBtn);
            
            div.appendChild(info);
            div.appendChild(actions);
            
            div.onclick = () => { currentSelectedName = p.name; isEditMode = false; renderDeck(); renderSidebar(); };
            sb.appendChild(div);
        });
    };
    renderList(pending, false);
    if (completed.length > 0) {
        const sep = document.createElement('div');
        sep.style = "padding: 10px; background: #000; font-size: 0.7rem; color: #555; text-align: center;";
        sep.textContent = "ZKONTROLOVÁNO";
        sb.appendChild(sep);
        renderList(completed, true);
    }
}

function renderDeck() {
    if (!currentSelectedName) return;
    const p = players.find(p => p.name === currentSelectedName);
    const info = document.getElementById('deckInfo');
    const searchArea = document.getElementById('searchArea');
    const grid = document.getElementById('deckGrid');
    
    const total = p.cards.reduce((sum, c) => sum + c.count, 0);
    const remaining = p.cards.reduce((sum, c) => sum + c.current, 0);
    const done = total - remaining;

    const statsHtml = !isEditMode ? `
        <div class="stats-bar">
            <div class="stat-item"><span class="stat-value">${total}</span><span class="stat-label">Celkem</span></div>
            <div class="stat-item" style="color: var(--success-color)"><span class="stat-value">${done}</span><span class="stat-label">Ověřeno</span></div>
            <div class="stat-item" style="color: ${remaining > 0 ? 'orange' : 'var(--success-color)'}"><span class="stat-value">${remaining}</span><span class="stat-label">Zbývá</span></div>
        </div>` : '';

    let verifyBtn = "";
    if (!isEditMode && p.validationErrors && p.validationErrors.length > 0) {
        verifyBtn = `<button class="btn-ctrl" style="background-color: var(--success-color); color: white;" onclick="verifyDeckErrors()">Deck verified</button>`;
    }

    const buttonsHtml = isEditMode 
        ? `<button class="btn-check-all" onclick="toggleEditMode()">Uložit Deck</button>`
        : `${verifyBtn}
           <button class="btn-ctrl" style="background-color: yellow; color: black; font-weight: bold;" onclick="toggleEditMode()">Upravit</button>
           <button class="btn-check-all" onclick="checkAllCards()">Ověřit vše</button>
           <button class="btn-reset" onclick="resetDeck()">Reset</button>`;

    const archHtml = p.arch ? p.arch.split(/([&+])/).map(part => {
        const trimmed = part.trim();
        if (!trimmed || ['&', '+'].includes(trimmed)) return part;
        return `<span class="commander-name" data-name="${trimmed}" style="cursor:help; border-bottom:1px dotted #888;">${part}</span>`;
    }).join('') : "";

    info.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; gap: 20px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
                <h1 style="margin:0; font-size: 1.8rem;">${p.name}</h1>
                <div style="font-size:1rem; font-weight:bold; color:#fff;">${archHtml}</div>
            </div>
            <div style="display:flex; align-items:center; gap: 20px; flex-wrap: wrap; justify-content: flex-end;">
                ${statsHtml}
                <div style="display:flex; gap: 8px;">${buttonsHtml}</div>
            </div>
        </div>
    `;

    info.querySelectorAll('.commander-name').forEach(span => {
        span.addEventListener('mouseenter', async (e) => {
            span._isHovering = true;
            const name = span.getAttribute('data-name');
            const src = await getCardImageUrl(name);
            if (span._isHovering && src) window.showCardPreview(e, src);
        });
        span.addEventListener('mousemove', (e) => window.moveCardPreview(e));
        span.addEventListener('mouseleave', () => {
            span._isHovering = false;
            window.hideCardPreview();
        });
    });

    const placeholder = isEditMode ? "Přidat kartu (Scryfall)..." : "Hledat kartu...";
    searchArea.innerHTML = `<div class="search-container"><input type="text" id="cardSearch" placeholder="${placeholder}" autocomplete="off"><div id="autocompleteResults" class="autocomplete-results"></div></div>`;
    setupSearch();

    grid.innerHTML = "";
    const cardsWithIdx = p.cards.map((c, i) => ({...c, originalIdx: i}));
    
    let displayCards;
    if (isEditMode) {
        displayCards = cardsWithIdx;
    } else {
        displayCards = [...cardsWithIdx.filter(c => c.current > 0), ...cardsWithIdx.filter(c => c.current === 0)];
    }

    displayCards.forEach((card) => {
        const container = document.createElement('div');
        container.className = `card-container ${!isEditMode && card.current === 0 ? 'done' : ''}`;
        
        // Image Wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'card-image-wrapper';
        if (!isEditMode) {
            wrapper.onclick = () => updateCard(card.originalIdx, -1);
        }

        // Placeholder s textem
        const placeholder = document.createElement('div');
        placeholder.className = 'card-placeholder';
        placeholder.textContent = card.name;

        // Samotný obrázek
        const img = document.createElement('img');
        img.className = 'card-image';
        img.alt = card.name;

        getSmartImage(card.name, img, placeholder);

        wrapper.appendChild(placeholder);
        wrapper.appendChild(img);
        
        const ctrl = document.createElement('div');
        ctrl.className = 'card-controls';
        
        if (isEditMode) {
            ctrl.innerHTML = `
                <button class="btn-ctrl btn-reset" style="padding: 5px 10px; background: var(--danger-color);" onclick="editCardCount(${card.originalIdx}, -1)">-</button>
                <div class="count-badge">${card.count}</div>
                <button class="btn-ctrl btn-plus" onclick="editCardCount(${card.originalIdx}, 1)">+</button>
            `;
        } else {
            ctrl.innerHTML = `
                <button class="btn-ctrl" onclick="updateCard(${card.originalIdx}, -1)">-</button>
                <div class="count-badge">${card.current}</div>
                <button class="btn-ctrl btn-plus" onclick="updateCard(${card.originalIdx}, 1)">+</button>
            `;
        }
        
        container.appendChild(wrapper);
        container.appendChild(ctrl);
        grid.appendChild(container);
    });
}

// --- SEARCH LOGIC ---
function setupSearch() {
    const input = document.getElementById('cardSearch');
    const resultsDiv = document.getElementById('autocompleteResults');
    const p = players.find(p => p.name === currentSelectedName);

    input.addEventListener('input', () => {
        const val = input.value;
        highlightedIndex = -1;
        
        if (isEditMode) {
            if (val.length < 3) { resultsDiv.style.display = "none"; return; }
            
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                try {
                    const response = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(val)}`);
                    if (!response.ok) return;
                    const json = await response.json();
                    const suggestions = json.data.slice(0, 5);
                    
                    resultsDiv.innerHTML = "";
                    if (suggestions.length > 0) {
                        resultsDiv.style.display = "block";
                        suggestions.forEach((name) => {
                            const div = document.createElement('div');
                            div.className = 'autocomplete-item';
                            div.textContent = name;
                            div.onclick = () => {
                                addCardToDeck(name);
                                resultsDiv.style.display = "none";
                            };
                            resultsDiv.appendChild(div);
                        });
                    } else {
                        resultsDiv.style.display = "none";
                    }
                } catch (e) { console.error(e); }
            }, 300);
        } else {
            const valLower = val.toLowerCase();
            if (valLower.length < 2) { resultsDiv.style.display = "none"; return; }
            const matches = p.cards.map((c, i) => ({...c, idx: i})).filter(c => c.name.toLowerCase().includes(valLower) && c.current > 0);
            
            resultsDiv.innerHTML = "";
            if (matches.length > 0) {
                resultsDiv.style.display = "block";
                matches.forEach((m) => {
                    const div = document.createElement('div');
                    div.className = 'autocomplete-item';
                    div.innerHTML = `<span>${m.name}</span> <span style="opacity:0.5">${m.current}x</span>`;
                    div.onclick = () => {
                        updateCard(m.idx, -1);
                        input.value = "";
                        resultsDiv.style.display = "none";
                        input.focus();
                    };
                    resultsDiv.appendChild(div);
                });
            } else resultsDiv.style.display = "none";
        }
    });

    input.addEventListener('keydown', (e) => {
        const items = resultsDiv.getElementsByClassName('autocomplete-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') { e.preventDefault(); highlightedIndex = (highlightedIndex + 1) % items.length; updateHighlight(items); } 
        else if (e.key === 'ArrowUp') { e.preventDefault(); highlightedIndex = (highlightedIndex - 1 + items.length) % items.length; updateHighlight(items); } 
        else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex > -1) items[highlightedIndex].click();
            else if (!isEditMode && items.length === 1) items[0].click();
            else if (isEditMode && items.length > 0) items[0].click();
        }
    });

    function updateHighlight(items) {
        Array.from(items).forEach((it, i) => it.classList.toggle('highlighted', i === highlightedIndex));
    }
}

window.updateCard = (idx, delta) => {
    const p = players.find(p => p.name === currentSelectedName);
    const c = p.cards[idx];
    c.current = Math.max(0, Math.min(c.count, c.current + delta));
    saveState();
    renderDeck();
    renderSidebar();
    if (document.getElementById('cardSearch')) document.getElementById('cardSearch').focus();
};

window.resetDeck = () => {
    const p = players.find(p => p.name === currentSelectedName);
    p.cards.forEach(c => c.current = c.count);
    saveState();
    renderDeck(); renderSidebar();
};

window.checkAllCards = () => {
    const p = players.find(p => p.name === currentSelectedName);
    p.cards.forEach(c => c.current = 0);
    saveState();
    renderDeck(); renderSidebar();
};

window.verifyDeckErrors = () => {
    const p = players.find(p => p.name === currentSelectedName);
    if (p) {
        p.validationErrors = [];
        saveState();
        renderDeck();
        renderSidebar();
    }
};

window.toggleEditMode = () => {
    isEditMode = !isEditMode;
    renderDeck();
};

window.editCardCount = (idx, delta) => {
    const p = players.find(p => p.name === currentSelectedName);
    const c = p.cards[idx];
    c.count += delta;
    if (c.count <= 0) {
        p.cards.splice(idx, 1);
    } else {
        c.current = c.count; 
    }
    saveState();
    renderDeck();
};

window.addCardToDeck = (cardName) => {
    const p = players.find(p => p.name === currentSelectedName);
    const normName = normalizeCardName(cardName);
    const existing = p.cards.find(c => c.name === normName);
    if (existing) {
        existing.count++;
        existing.current = existing.count;
    } else {
        p.cards.push({ count: 1, current: 1, name: normName });
        p.cards.sort((a, b) => a.name.localeCompare(b.name));
    }
    saveState();
    renderDeck();
    const input = document.getElementById('cardSearch');
    if(input) {
        input.value = "";
        input.focus();
    }
};

window.showErrorModal = (title, messages) => {
    let modal = document.getElementById('errorModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'errorModal';
        modal.style.cssText = "display:none; position:fixed; z-index:10001; left:0; top:0; width:100%; height:100%; background-color:rgba(0,0,0,0.8);";
        modal.innerHTML = `
            <div style="background-color:#222; margin:10% auto; padding:20px; border:1px solid #888; width:80%; max-width:500px; border-radius:8px; position:relative;">
                <span style="position:absolute; top:10px; right:20px; font-size:28px; cursor:pointer;" onclick="document.getElementById('errorModal').style.display='none'">&times;</span>
                <h2 id="errTitle" style="color:var(--danger-color); margin-top:0;"></h2>
                <div id="errContent" style="margin-top:15px; max-height:300px; overflow-y:auto;"></div>
                <div style="margin-top:20px; text-align:right;">
                    <button class="btn-ctrl" onclick="document.getElementById('errorModal').style.display='none'">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    document.getElementById('errTitle').textContent = title;
    const content = document.getElementById('errContent');
    content.innerHTML = "";
    if (Array.isArray(messages)) {
        messages.forEach(m => content.innerHTML += `<div style="margin-bottom:5px;">• ${m}</div>`);
    } else {
        content.textContent = messages;
    }
    modal.style.display = "block";
};

// --- MODAL LOGIC ---
window.openAddModal = () => {
    const modal = document.getElementById('addDeckModal');
    const decklistArea = document.getElementById('newDecklist');

    // Dynamické přidání Moxfield importu, pokud neexistuje
    if (!document.getElementById('moxfieldInputContainer')) {
        const container = document.createElement('div');
        container.id = 'moxfieldInputContainer';
        container.style.cssText = "display: flex; gap: 10px; margin-bottom: 15px; align-items: center;";

        const input = document.createElement('input');
        input.id = 'moxfieldUrl';
        input.type = 'text';
        input.placeholder = 'Export z Moxfield.com (URL)...';
        input.style.flex = "1";
        input.style.padding = "8px";
        input.style.borderRadius = "4px";
        input.style.border = "1px solid #444";
        input.style.background = "#222";
        input.style.color = "#fff";

        const btn = document.createElement('button');
        btn.textContent = 'Import';
        btn.className = 'btn-ctrl';
        btn.style.padding = "8px 15px";
        btn.style.cursor = "pointer";

        btn.onclick = async (e) => {
            e.preventDefault();
            const url = input.value.trim();
            if (!url) return;

            const match = url.match(/moxfield\.com\/decks\/([a-zA-Z0-9\-_]+)/);
            if (!match) {
                alert("Neplatná Moxfield URL.");
                return;
            }

            const originalText = btn.textContent;
            btn.textContent = "⏳";
            btn.disabled = true;

            try {
                // Použití CORS proxy pro obejití omezení prohlížeče
                const targetUrl = `https://api.moxfield.com/v2/decks/all/${match[1]}`;
                let data;
                let errorMsg = "";

                // Definice proxy serverů a způsobů parsování
                const proxies = [
                    {
                        name: "CorsProxy.io",
                        getUrl: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
                        parse: async (res) => await res.json()
                    },
                    {
                        name: "AllOrigins (Raw)",
                        getUrl: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}&timestamp=${Date.now()}`,
                        parse: async (res) => await res.json()
                    },
                    {
                        name: "CodeTabs",
                        getUrl: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
                        parse: async (res) => await res.json()
                    },
                    {
                        name: "AllOrigins (JSON)",
                        getUrl: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&timestamp=${Date.now()}`,
                        parse: async (res) => {
                            const json = await res.json();
                            if (!json.contents) throw new Error("No contents");
                            return JSON.parse(json.contents);
                        }
                    },
                    {
                        name: "ThingProxy",
                        getUrl: (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
                        parse: async (res) => await res.json()
                    }
                ];

                for (const proxy of proxies) {
                    if (data) break;
                    try {
                        const resp = await fetch(proxy.getUrl(targetUrl));
                        if (resp.ok) {
                            const json = await proxy.parse(resp);
                            // Ověření, že jde o Moxfield data
                            if (json && (json.commanders || json.mainboard)) {
                                data = json;
                            } else {
                                errorMsg += `${proxy.name}: Invalid data; `;
                            }
                        } else {
                            errorMsg += `${proxy.name}: Status ${resp.status}; `;
                        }
                    } catch (e) {
                        console.warn(`${proxy.name} failed`, e);
                        errorMsg += `${proxy.name}: ${e.message}; `;
                    }
                }

                if (!data) throw new Error("Nepodařilo se stáhnout data přes proxy. Detaily: " + errorMsg);

                const commanders = Object.keys(data.commanders || {});
                const companions = Object.keys(data.companions || {});
                
                let archStr = commanders.join(" & ");
                if (companions.length > 0) {
                    archStr += (archStr ? " + " : "") + companions.join(" & ");
                }
                
                if (archStr) {
                    document.getElementById('newPlayerArchetype').value = archStr;
                }

                let text = "";
                // Mainboard
                for (const [name, info] of Object.entries(data.mainboard || {})) {
                    text += `${info.quantity} ${name}\n`;
                }
                // Sideboard
                if (data.sideboard && Object.keys(data.sideboard).length > 0) {
                    let sbText = "";
                    for (const [name, info] of Object.entries(data.sideboard)) {
                        if (companions.includes(name)) continue;
                        sbText += `${info.quantity} ${name}\n`;
                    }
                    if (sbText) {
                        text += "SIDEBOARD:\n" + sbText;
                    }
                }

                document.getElementById('newDecklist').value = text;
                input.value = "";
                document.getElementById('newDecklist').dispatchEvent(new Event('input'));
            } catch (err) {
                console.error(err);
                alert("Chyba při importu z Moxfield: " + err.message);
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        };

        container.appendChild(input);
        container.appendChild(btn);

        if (decklistArea) {
            decklistArea.parentNode.insertBefore(container, decklistArea);
        }
    }

    // Dynamické přidání počítadla karet
    if (!document.getElementById('addDeckStats')) {
        const statsContainer = document.createElement('div');
        statsContainer.id = 'addDeckStats';
        statsContainer.className = 'stats-bar';
        
        statsContainer.innerHTML = `
            <div class="stat-item">
                <span class="stat-value" id="addDeckTotal">0</span>
                <span class="stat-label">Karet</span>
            </div>
            <div id="addDeckCheck" style="display:none; font-size: 1.5rem;">✅</div>
        `;

        const header = modal.querySelector('h2');
        // Zkusíme najít zavírací tlačítko (třída .close, .close-modal nebo obsahující ×)
        let closeBtn = modal.querySelector('.close, .close-modal');
        if (!closeBtn) {
            const spans = modal.getElementsByTagName('span');
            for (let s of spans) {
                if (s.innerHTML.includes('&times;') || s.textContent.includes('×')) {
                    closeBtn = s;
                    break;
                }
            }
        }

        if (header) {
            header.style.display = "flex";
            header.style.alignItems = "center";
            header.style.justifyContent = "flex-start";
            header.style.flexWrap = "nowrap";
            header.style.margin = "0 0 15px 0";

            statsContainer.style.cssText = "display: flex; gap: 15px; align-items: center; font-size: 1rem; font-weight: normal; margin-left: auto;";
            header.appendChild(statsContainer);

            if (closeBtn) {
                closeBtn.style.cssText = "float: none; position: static; margin-left: 15px; cursor: pointer; font-size: 28px; line-height: 1; display: block; width: auto; height: auto;";
                header.appendChild(closeBtn);
            }
        } else if (decklistArea) {
            statsContainer.style.cssText = "display: flex; gap: 15px; margin-bottom: 10px; align-items: center; justify-content: flex-end;";
            decklistArea.parentNode.insertBefore(statsContainer, decklistArea);
        }

        const updateStats = () => {
            const listText = decklistArea.value;
            const archText = document.getElementById('newPlayerArchetype').value;
            
            let cardCount = 0;
            listText.split('\n').forEach(line => {
                const lineTrim = line.trim();
                if (!lineTrim || lineTrim.includes("SIDEBOARD:")) return;
                const match = lineTrim.match(/^(\d+)\s+(.+)$/);
                if (match) {
                    cardCount += parseInt(match[1]);
                } else if (lineTrim) {
                    cardCount += 1;
                }
            });

            let commanderCount = 0;
            if (archText.trim()) {
                const archNorm = archText.replace(/\/\/|\//g, (m) => m === '//' ? '//' : ' & ');
                commanderCount = archNorm.split(/[&+]/).length;
            }

            const total = cardCount + commanderCount;
            const totalEl = document.getElementById('addDeckTotal');
            const checkEl = document.getElementById('addDeckCheck');
            
            if (totalEl) {
                totalEl.textContent = total;
                totalEl.style.color = total === 100 ? "var(--success-color)" : "";
            }
            
            if (checkEl) {
                checkEl.style.display = total === 100 ? "block" : "none";
            }
        };

        decklistArea.addEventListener('input', updateStats);
        document.getElementById('newPlayerArchetype').addEventListener('input', updateStats);
    }

    modal.style.display = "block";
    document.getElementById('newPlayerName').focus();
    
    // Aktualizace počítadla při otevření
    if (document.getElementById('addDeckStats')) {
        document.getElementById('newDecklist').dispatchEvent(new Event('input'));
    }

    // Nastavení tlačítka na Validaci
    const saveBtn = document.querySelector('button[onclick="saveNewPlayer()"]');
    if (saveBtn) {
        saveBtn.textContent = "Ověřit decklist";
        saveBtn.onclick = window.validateDeck;
        saveBtn.classList.remove('btn-success'); // Pokud existuje styl pro úspěch
        
        // Pokud uživatel něco změní, resetujeme tlačítko zpět na validaci
        const resetBtn = () => {
            saveBtn.textContent = "Ověřit decklist";
            saveBtn.onclick = window.validateDeck;
        };
        document.getElementById('newDecklist').addEventListener('input', resetBtn, { once: true });
        document.getElementById('newPlayerArchetype').addEventListener('input', resetBtn, { once: true });
    }
};

window.closeAddModal = () => {
    document.getElementById('addDeckModal').style.display = "none";
};

window.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
});

window.validateDeck = async () => {
    const btn = document.querySelector('button[onclick="saveNewPlayer()"]') || document.activeElement;
    const originalText = btn.textContent;
    btn.textContent = "Ověřuji...";
    btn.disabled = true;

    try {
        const arch = document.getElementById('newPlayerArchetype').value.trim();
        const listText = document.getElementById('newDecklist').value;
        
        // 1. Kontrola počtu karet
        let cardCount = 0;
        const cardNames = [];
        
        listText.split('\n').forEach(line => {
            const lineTrim = line.trim();
            if (!lineTrim || lineTrim.includes("SIDEBOARD:")) return;
            const match = lineTrim.match(/^(\d+)\s+(.+)$/);
            if (match) {
                cardCount += parseInt(match[1]);
                cardNames.push(normalizeCardName(match[2]));
            } else if (lineTrim) {
                cardCount += 1;
                cardNames.push(normalizeCardName(lineTrim));
            }
        });

        let commanderCount = 0;
        if (arch) {
            const archNorm = arch.replace(/\/\/|\//g, (m) => m === '//' ? '//' : ' & ');
            const parts = archNorm.split(/[&+]/).map(s => s.trim()).filter(s => s);
            commanderCount = parts.length;
            parts.forEach(p => cardNames.push(normalizeCardName(p)));
        }

        const hasCompanion = arch.includes('+');
        const targetTotal = hasCompanion ? 101 : 100;
        const currentTotal = cardCount + commanderCount;

        if (currentTotal !== targetTotal) {
            throw new Error(`Nesprávný počet karet! <br>Současný počet: <b>${currentTotal}</b><br>Požadovaný počet: <b>${targetTotal}</b> ${hasCompanion ? '(včetně Companion)' : ''}`);
        }

        // 2. Kontrola jmen karet (Scryfall)
        const invalidCards = await validateCardsBatch(cardNames);
        if (invalidCards.length > 0) {
            window.resolveUnknownCards(invalidCards);
            return;
        }

        // Vše OK
        btn.textContent = "Uložit";
        btn.onclick = window.saveNewPlayer;
    } catch (e) {
        window.showErrorModal("Chyba validace", e.message.startsWith("Nesprávný") ? e.message : [e.message]);
    } finally {
        if (btn.textContent !== "Uložit") btn.textContent = originalText;
        btn.disabled = false;
    }
};

window.resolveUnknownCards = async (invalidCards) => {
    let modal = document.getElementById('resolveModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'resolveModal';
        modal.style.cssText = "display:none; position:fixed; z-index:10002; left:0; top:0; width:100%; height:100%; background-color:rgba(0,0,0,0.9);";
        modal.innerHTML = `
            <div style="background-color:#222; margin:5% auto; padding:20px; border:1px solid #888; width:90%; max-width:600px; border-radius:8px; position:relative; max-height: 90vh; display: flex; flex-direction: column;">
                <h2 style="color:var(--warning-color); margin-top:0;">Neznámé karty</h2>
                <div style="margin-bottom: 15px; color: #ccc;">Následující karty nebyly nalezeny. Vyberte správnou variantu nebo ponechte původní.</div>
                <div id="resolveContent" style="flex: 1; overflow-y:auto; margin-bottom: 20px; padding-right: 5px;"></div>
                <div style="text-align:right; border-top: 1px solid #444; padding-top: 15px;">
                    <button class="btn-ctrl" onclick="document.getElementById('resolveModal').style.display='none'">Zrušit</button>
                    <button class="btn-ctrl btn-success" onclick="applyCardResolutions()">Použít opravy</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const content = document.getElementById('resolveContent');
    content.innerHTML = '<div style="text-align:center; padding:20px;">Načítám návrhy...</div>';
    modal.style.display = "block";

    const suggestionsMap = {};
    
    await Promise.all(invalidCards.map(async (name) => {
        try {
            let suggestions = [];
            
            // 1. Zkusíme přesný název
            let resp = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(name)}`);
            if (resp.ok) {
                const json = await resp.json();
                suggestions = json.data || [];
            }

            // 2. Pokud nic a obsahuje //, zkusíme první část (pro split karty)
            if (suggestions.length === 0 && name.includes('//')) {
                const part = name.split('//')[0].trim();
                resp = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(part)}`);
                if (resp.ok) {
                    const json = await resp.json();
                    suggestions = json.data || [];
                }
            }

            // 3. Fallback: Zkusíme bez posledního slova
            if (suggestions.length === 0 && name.includes(' ')) {
                const withoutLastWord = name.substring(0, name.lastIndexOf(' ')).trim();
                if (withoutLastWord.length > 2) {
                    resp = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(withoutLastWord)}`);
                    if (resp.ok) {
                        const json = await resp.json();
                        suggestions = json.data || [];
                    }
                }
            }

            // 4. Fallback: Zkusíme bez posledních 1-2 znaků
            if (suggestions.length === 0 && name.length > 4) {
                for (let i = 1; i <= 2; i++) {
                    resp = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(name.slice(0, -i))}`);
                    if (resp.ok) {
                        const json = await resp.json();
                        suggestions = json.data || [];
                        if (suggestions.length > 0) break;
                    }
                }
            }

            // 5. Fallback: Pokud stále nic, zkusíme první slovo (pokud je dost dlouhé)
            if (suggestions.length === 0) {
                const firstWord = name.split(/[\s/]+/)[0];
                if (firstWord && firstWord.length > 3 && firstWord !== name) {
                    resp = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(firstWord)}`);
                    if (resp.ok) {
                        const json = await resp.json();
                        suggestions = json.data || [];
                    }
                }
            }

            suggestionsMap[name] = suggestions;
        } catch (e) {
            suggestionsMap[name] = [];
        }
    }));

    content.innerHTML = "";
    invalidCards.forEach((name, index) => {
        const row = document.createElement('div');
        row.style.cssText = "margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #333;";
        
        const label = document.createElement('div');
        label.innerHTML = `Původní název: <strong style="color: #ff5252">${name}</strong>`;
        row.appendChild(label);

        const select = document.createElement('select');
        select.id = `resolve-select-${index}`;
        select.dataset.original = name;
        select.style.cssText = "width: 100%; padding: 8px; margin-top: 5px; background: #333; color: white; border: 1px solid #555; border-radius: 4px;";
        
        const keepOpt = document.createElement('option');
        keepOpt.value = name;
        keepOpt.textContent = `Ponechat: "${name}"`;
        select.appendChild(keepOpt);

        (suggestionsMap[name] || []).forEach(sugg => {
            if (sugg !== name) {
                const opt = document.createElement('option');
                opt.value = sugg;
                opt.textContent = `Opravit na: "${sugg}"`;
                select.appendChild(opt);
            }
        });

        row.appendChild(select);
        content.appendChild(row);
    });
};

window.applyCardResolutions = async () => {
    const selects = document.querySelectorAll('#resolveContent select');
    let decklistVal = document.getElementById('newDecklist').value;
    let archetypeVal = document.getElementById('newPlayerArchetype').value;
    let modified = false;
    
    // 1. Uložíme všechna rozhodnutí (i "Ponechat") do DB jako validní karty
    try {
        const db = await initCardDB();
        const tx = db.transaction(cardStoreName, "readwrite");
        const store = tx.objectStore(cardStoreName);
        
        await Promise.all(Array.from(selects).map(sel => {
            return new Promise(resolve => {
                const req = store.put({ name: sel.value, timestamp: Date.now() });
                req.onsuccess = resolve;
                req.onerror = resolve;
            });
        }));
    } catch (e) { console.error("DB Error", e); }

    // 2. Aplikujeme změny v textu
    if (window.csvImportActive) {
        const selects = document.querySelectorAll('#resolveContent select');
        selects.forEach(sel => {
            const original = sel.dataset.original;
            const selected = sel.value;
            
            if (original !== selected) {
                window.csvCandidates.forEach(p => {
                    p.cards.forEach(c => {
                        if (c.name === original) c.name = selected;
                    });
                    if (p.arch) {
                        const parts = p.arch.split(/([&+])/);
                        p.arch = parts.map(part => {
                            const trimmed = part.trim();
                            if (!trimmed || ['&', '+'].includes(trimmed)) return part;
                            if (normalizeCardName(trimmed) === original) {
                                return part.replace(trimmed, selected); 
                            }
                            return part;
                        }).join('');
                    }
                });
            }
        });
        
        document.getElementById('resolveModal').style.display = 'none';
        await validateCSVAndImport();
        return;
    }

    selects.forEach(sel => {
        const original = sel.dataset.original;
        const selected = sel.value;
        
        if (original !== selected) {
            modified = true;
            const lines = decklistVal.split('\n');
            const newLines = lines.map(line => {
                const lineTrim = line.trim();
                if (!lineTrim || lineTrim.includes("SIDEBOARD:")) return line;
                const match = lineTrim.match(/^(\d+)\s+(.+)$/);
                if (match) {
                    if (normalizeCardName(match[2]) === original) return `${match[1]} ${selected}`;
                } else {
                    if (normalizeCardName(lineTrim) === original) return selected;
                }
                return line;
            });
            decklistVal = newLines.join('\n');

            if (archetypeVal) {
                const parts = archetypeVal.split(/([&+])/);
                const newParts = parts.map(p => {
                    const trimmed = p.trim();
                    if (!trimmed || ['&', '+'].includes(trimmed)) return p;
                    if (normalizeCardName(trimmed) === original) return p.replace(trimmed, selected);
                    return p;
                });
                archetypeVal = newParts.join('');
            }
        }
    });
    
    if (modified) {
        document.getElementById('newDecklist').value = decklistVal;
        document.getElementById('newPlayerArchetype').value = archetypeVal;
        document.getElementById('newDecklist').dispatchEvent(new Event('input'));
    }
    
    document.getElementById('resolveModal').style.display = 'none';
    window.validateDeck();
};

window.saveNewPlayer = () => {
    const name = document.getElementById('newPlayerName').value.trim();
    const arch = document.getElementById('newPlayerArchetype').value.trim().replace(/\/\/|\//g, (m) => m === '//' ? '//' : ' & ');
    const listText = document.getElementById('newDecklist').value;

    if (!name) { alert("Zadejte jméno hráče."); return; }
    if (!listText) { alert("Zadejte decklist."); return; }

    const existingIdx = players.findIndex(p => p.name === name);
    if (existingIdx !== -1 && !confirm(`Hráč "${name}" již existuje. Chcete přepsat jeho decklist?`)) return;

    let cards = [];
    listText.split('\n').forEach(line => {
        const lineTrim = line.trim();
        if (!lineTrim || lineTrim.includes("SIDEBOARD:")) return;
        const match = lineTrim.match(/^(\d+)\s+(.+)$/);
        if (match) cards.push({ count: parseInt(match[1]), current: parseInt(match[1]), name: normalizeCardName(match[2]) });
        else cards.push({ count: 1, current: 1, name: normalizeCardName(lineTrim) });
    });
    cards.sort((a, b) => a.name.localeCompare(b.name));

    const newPlayer = { name, arch, cards };
    if (existingIdx !== -1) players[existingIdx] = newPlayer; else players.push(newPlayer);
    
    players.sort((a, b) => a.name.localeCompare(b.name));
    saveState();
    renderSidebar();
    closeAddModal();
    
    document.getElementById('newPlayerName').value = "";
    document.getElementById('newPlayerArchetype').value = "";
    document.getElementById('newDecklist').value = "";
};

// --- META LOGIC ---
window.showMeta = () => {
    const counts = {};
    players.forEach(p => {
        const arch = p.arch || "Unknown";
        counts[arch] = (counts[arch] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    const listDiv = document.getElementById('metaList');
    listDiv.innerHTML = "";
    
    if (sorted.length === 0) {
        listDiv.innerHTML = "<div style='text-align:center; opacity:0.6;'>Žádná data.</div>";
    } else {
        sorted.forEach(([arch, count]) => {
            const row = document.createElement('div');
            row.style.cssText = "display: flex; justify-content: space-between; padding: 8px 10px 8px 0; border-bottom: 1px solid #333;";
            row.innerHTML = `<span>${arch}</span><span style="font-weight:bold;">${count}</span>`;
            listDiv.appendChild(row);
        });
    }

    document.getElementById('metaModal').style.display = "block";
};

window.closeMetaModal = () => {
    document.getElementById('metaModal').style.display = "none";
};

window.copyMetaToClipboard = () => {
    const listDiv = document.getElementById('metaList');
    const text = Array.from(listDiv.children).map(div => `${div.lastElementChild.textContent}x ${div.firstElementChild.textContent}`).join('\n');
    navigator.clipboard.writeText(text).then(() => alert("Zkopírováno do schránky!"));
};

// --- EXPORT LOGIC ---
window.exportTournament = () => {
    if (players.length === 0) {
        alert("Žádná data k exportu.");
        return;
    }

    const header = ["first_name", "last_name", "archetype", "plaintext_list", "is_checked"];
    const rows = [header.join(",")];

    players.forEach(p => {
        const decklist = p.cards.map(c => `${c.count} ${c.name}`).join("\n");
        const isChecked = isPlayerDone(p) ? "1" : "0";
        
        const escape = (txt) => {
            if (txt === null || txt === undefined) return "";
            txt = String(txt);
            if (txt.includes(",") || txt.includes("\n") || txt.includes('"')) {
                return `"${txt.replace(/"/g, '""')}"`;
            }
            return txt;
        };

        const row = [
            escape(p.name), // first_name (using full name here)
            escape(""),     // last_name (empty)
            escape(p.arch),
            escape(decklist),
            escape(isChecked)
        ];
        rows.push(row.join(","));
    });

    const csvContent = rows.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const date = new Date().toISOString().slice(0,10);
    link.setAttribute("download", `tournament_export_${date}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// --- PERSISTENCE ---
function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}

function loadState() {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
        try {
            players = JSON.parse(data);
            renderSidebar();
        } catch (e) { console.error("Failed to load state", e); }
    }
}

window.showCardPreview = (e, src) => {
    if (!src || src === "" || src === window.location.href) return;
    
    let div = document.getElementById('cardHoverPreview');
    if (!div) {
        div = document.createElement('div');
        div.id = 'cardHoverPreview';
        div.style.cssText = "position: fixed; display: none; z-index: 9999; pointer-events: none; top: 0; left: 0;";
        const img = document.createElement('img');
        img.style.cssText = "max-width: 300px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.5);";
        div.appendChild(img);
        document.body.appendChild(div);
    }
    
    const img = div.querySelector('img');
    img.src = src;
    div.style.display = 'block';
    window.moveCardPreview(e);
};

window.moveCardPreview = (e) => {
    const div = document.getElementById('cardHoverPreview');
    if (!div || div.style.display === 'none') return;
    
    const img = div.querySelector('img');
    let top = e.clientY + 15;
    let left = e.clientX + 15;
    
    if (img && (left + img.offsetWidth > window.innerWidth)) left = e.clientX - img.offsetWidth - 15;
    if (img && (top + img.offsetHeight > window.innerHeight)) top = e.clientY - img.offsetHeight - 15;
    
    div.style.top = `${top}px`;
    div.style.left = `${left}px`;
};

window.hideCardPreview = () => {
    const div = document.getElementById('cardHoverPreview');
    if (div) div.style.display = 'none';
};

loadState();
