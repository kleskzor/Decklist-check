window.loadTournament = async (filePath, tournamentName) => {
    if (players.length > 0 && !confirm(`Opravdu chcete načíst turnaj "${tournamentName}"? Tím přepíšete aktuální data.`)) {
        return;
    }

    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP chyba: ${response.status}`);
        const text = await response.text();
        await parseCSV(text);
    } catch (err) {
        console.error(err);
        alert(`Nepodařilo se načíst turnajová data pro "${tournamentName}".\n\nPoznámka: Tlačítko funguje pouze pokud aplikace běží na webovém serveru (http/https). Při lokálním otevření (file://) prohlížeč načítání blokuje.\n\nDetaily chyby: ` + err.message);
    }
}
// --- CSV PARSING ---
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

// --- MTG TOP 8 EXPORT ---
window.openExportModal = () => {
    if (!currentSelectedName) return;
    document.getElementById('exportModal').style.display = "block";
};

window.closeExportModal = () => {
    document.getElementById('exportModal').style.display = "none";
};

window.copyExportArchetype = () => {
    if (!currentSelectedName) return;
    const p = players.find(p => p.name === currentSelectedName);
    if (p && p.arch) {
        navigator.clipboard.writeText(p.arch).then(() => {
            const btn = document.querySelector('#exportModal button[onclick="copyExportArchetype()"]');
            const original = btn.textContent;
            btn.textContent = "Zkopírováno!";
            setTimeout(() => btn.textContent = original, 1500);
        });
    }
};

window.copyExportPlayer = () => {
    if (!currentSelectedName) return;
    const p = players.find(p => p.name === currentSelectedName);
    if (p && p.name) {
        navigator.clipboard.writeText(p.name).then(() => {
            const btn = document.querySelector('#exportModal button[onclick="copyExportPlayer()"]');
            const original = btn.textContent;
            btn.textContent = "Zkopírováno!";
            setTimeout(() => btn.textContent = original, 1500);
        });
    }
};

window.copyExportDecklist = () => {
    if (!currentSelectedName) return;
    const p = players.find(p => p.name === currentSelectedName);
    if (!p) return;

    let text = "";
    // Mainboard
    p.cards.forEach(c => {
        text += `${c.count} ${c.name}\n`;
    });

    // Sideboard (Commanders + Companions)
    text += "SIDEBOARD\n";
    
    if (p.arch) {
        // Logic to split commanders and companions
        // Assuming format: Commander1 & Commander2 + Companion
        const parts = p.arch.split('+');
        const commandersPart = parts[0];
        const companionPart = parts.length > 1 ? parts[1] : null;

        // Commanders
        if (commandersPart) {
            // Split by & or // (if not normalized)
            const commanders = commandersPart.split(/&|\/\//).map(s => s.trim()).filter(s => s);
            commanders.forEach(c => {
                text += `1 ${c}\n`;
            });
        }

        // Companion (last line)
        if (companionPart) {
            text += `1 ${companionPart.trim()}\n`;
        }
    }

    navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector('#exportModal button[onclick="copyExportDecklist()"]');
        const original = btn.textContent;
        btn.textContent = "Zkopírováno!";
        setTimeout(() => btn.textContent = original, 1500);
    });
};