// --- MODAL LOGIC ---
window.openAddModal = () => {
    const modal = document.getElementById('addDeckModal');
    const decklistArea = document.getElementById('newDecklist');

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