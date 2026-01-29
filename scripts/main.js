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

function parseCSV(text) {
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

    players = rows.slice(1).map(r => {
        const name = `${r[fIdx]} ${r[lIdx]}`.trim();
        const list = r[listIdx] || "";
        let arch = r[archIdx] || "";
        let cards = [];
        list.split('\n').forEach(line => {
            const lineTrim = line.trim();
            if (!lineTrim || lineTrim.includes("SIDEBOARD:")) return;
            const match = lineTrim.match(/^(\d+)\s+(.+)$/);
            if (match) cards.push({ count: parseInt(match[1]), current: parseInt(match[1]), name: match[2] });
            else cards.push({ count: 1, current: 1, name: lineTrim });
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
    players.sort((a, b) => a.name.localeCompare(b.name));
    saveState();
    renderSidebar();
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

    const buttonsHtml = isEditMode 
        ? `<button class="btn-check-all" onclick="toggleEditMode()">Uložit Deck</button>`
        : `<button class="btn-ctrl" onclick="toggleEditMode()">Upravit</button>
           <button class="btn-check-all" onclick="checkAllCards()">Ověřit vše</button>
           <button class="btn-reset" onclick="resetDeck()">Reset</button>`;

    info.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 25px; gap: 20px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
                <h1 style="margin:0; font-size: 1.8rem;">${p.name}</h1>
                <div style="font-size:1rem; color:var(--accent-color);">${p.arch}</div>
            </div>
            ${statsHtml}
            <div style="display:flex; gap: 8px;">${buttonsHtml}</div>
        </div>
    `;

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
    const existing = p.cards.find(c => c.name === cardName);
    if (existing) {
        existing.count++;
        existing.current = existing.count;
    } else {
        p.cards.push({ count: 1, current: 1, name: cardName });
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

// --- MODAL LOGIC ---
window.openAddModal = () => {
    document.getElementById('addDeckModal').style.display = "block";
    document.getElementById('newPlayerName').focus();
};

window.closeAddModal = () => {
    document.getElementById('addDeckModal').style.display = "none";
};

window.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
});

window.saveNewPlayer = () => {
    const name = document.getElementById('newPlayerName').value.trim();
    const arch = document.getElementById('newPlayerArchetype').value.trim();
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
        if (match) cards.push({ count: parseInt(match[1]), current: parseInt(match[1]), name: match[2] });
        else cards.push({ count: 1, current: 1, name: lineTrim });
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

loadState();
