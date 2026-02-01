let players = [];
let currentSelectedName = null;
let highlightedIndex = -1;
let playerSearchQuery = "";
const STORAGE_KEY = 'mtg_decklist_data';
let isEditMode = false;
let searchTimeout = null;

const delay = (ms) => new Promise(res => setTimeout(res, ms));

function normalizeCardName(name) {
    // Nahradí jedno nebo více lomítek (s volitelnými mezerami) za " // "
    return name.trim().replace(/\s*\/+\s*/g, ' // ');
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}

function loadState() {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
        try {
            players = JSON.parse(data);
            if (typeof renderSidebar === 'function') renderSidebar();
        } catch (e) { console.error("Failed to load state", e); }
    }
}