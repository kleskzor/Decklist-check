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