function updateHeaderStats() {
    const stats = document.getElementById('headerStats');
    if (!stats) return;
    
    if (players.length === 0) {
        stats.style.display = 'none';
        return;
    }
    
    const done = players.filter(p => isPlayerDone(p)).length;
    const invalid = players.filter(p => p.validationErrors && p.validationErrors.length > 0).length;
    stats.style.display = 'flex';
    stats.innerHTML = `
        <div class="stat-item"><span class="stat-value">${players.length}</span><span class="stat-label">Hráči</span></div>
        <div class="stat-item" style="color: var(--success-color)"><span class="stat-value">${done}</span><span class="stat-label">Hotovo</span></div>
        ${invalid > 0 ? `<div class="stat-item" style="color: var(--danger-color)"><span class="stat-value">${invalid}</span><span class="stat-label">Chyby</span></div>` : ''}
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

async function renderDeck() {
    if (!currentSelectedName) {
        document.getElementById('deckInfo').innerHTML = "";
        document.getElementById('searchArea').innerHTML = "";
        document.getElementById('deckGrid').innerHTML = "";
        return;
    }
    const p = players.find(p => p.name === currentSelectedName);
    const info = document.getElementById('deckInfo');
    const searchArea = document.getElementById('searchArea');
    const grid = document.getElementById('deckGrid');
    
    // Načteme detaily karet pro pokročilé vyhledávání
    await preloadCardDetailsForDeck(p.cards);
    
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
        ? `<button class="btn-ctrl" onclick="window.editArchetype()" style="margin-right: 10px;">✎ Změnit archetyp</button>
           <button class="btn-check-all" onclick="toggleEditMode()">Uložit Deck</button>`
        : `${verifyBtn}
           <button class="btn-ctrl" style="background-color: #7b1fa2; color: white;" onclick="openExportModal()">Export MTGTop8</button>
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
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                const valLower = input.value.toLowerCase();
                if (valLower.length < 2) {
                    resultsDiv.style.display = "none";
                    return;
                }

                const searchDetails = await getCardDetails(valLower);

                const matches = p.cards
                    .map((c, i) => ({...c, idx: i}))
                    .filter(c => {
                        if (c.current === 0) return false;

                        // 1. Přímá shoda v názvu
                        if (c.name.toLowerCase().includes(valLower)) return true;

                        // 2. Pokročilá shoda s použitím cache
                        const cardDetails = window.cardDetailCache[c.name];
                        if (cardDetails) {
                            // Shoda v kanonickém názvu
                            if (cardDetails.canonicalName.toLowerCase().includes(valLower)) return true;
                            // Shoda podle oracle_id (stejná karta, jiný tisk)
                            if (searchDetails && cardDetails.oracleId === searchDetails.oracleId) return true;
                        }
                        
                        return false;
                    });

                resultsDiv.innerHTML = "";
                if (matches.length > 0) {
                    resultsDiv.style.display = "block";
                    matches.forEach((m) => {
                        const div = document.createElement('div');
                        div.className = 'autocomplete-item';

                        const cardDetails = window.cardDetailCache[m.name];
                        let displayName = m.name;
                        if (cardDetails && cardDetails.canonicalName.toLowerCase() !== m.name.toLowerCase()) {
                            displayName = `${cardDetails.canonicalName} <span style="opacity:0.6; font-style:italic;">// ${m.name}</span>`;
                        }

                        div.innerHTML = `<span>${displayName}</span> <span style="opacity:0.5">${m.current}x</span>`;
                        div.onclick = () => {
                            updateCard(m.idx, -1);
                            input.value = "";
                            resultsDiv.style.display = "none";
                            input.focus();
                        };
                        resultsDiv.appendChild(div);
                    });
                } else {
                    resultsDiv.style.display = "none";
                }
            }, 300);
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

window.setupArchetypeSearch = () => {
    const input = document.getElementById('archetypeSearchInput');
    const resultsDiv = document.getElementById('archetypeSearchResults');
    
    if (!input || !resultsDiv || input.dataset.initialized) return;
    input.dataset.initialized = "true";

    let searchTimeout;

    input.addEventListener('input', () => {
        const val = input.value;
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
                            input.value = name;
                            resultsDiv.style.display = "none";
                        };
                        resultsDiv.appendChild(div);
                    });
                } else {
                    resultsDiv.style.display = "none";
                }
            } catch (e) { console.error(e); }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (e.target !== input && e.target !== resultsDiv) {
            resultsDiv.style.display = 'none';
        }
    });
};

window.closeArchetypeModal = () => {
    const modal = document.getElementById('editArchetypeModal');
    if (modal) modal.style.display = 'none';
};

window.saveArchetypeFromModal = () => {
    const input = document.getElementById('archetypeSearchInput');
    if (input) {
        window.updateArchetype(input.value);
        window.closeArchetypeModal();
    }
};