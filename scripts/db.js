// --- DB & IMAGE LOGIC ---
const dbName = "MTGImageCache";
const storeName = "images";

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

                    const saveTx = db.transaction(cardStoreName, "readwrite");
                    const saveStore = saveTx.objectStore(cardStoreName);

                    retryBatch.forEach(input => {
                        const frontName = input.name;
                        const originalName = retryMap[frontName];
                        
                        const isStillMissing = retryData.not_found && retryData.not_found.some(nf => nf.name === frontName);
                        
                        if (!isStillMissing) {
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
                const isMissing = notFoundNames.includes(name);
                if (!isMissing) {
                    saveStore.put({ name: name, timestamp: Date.now() });
                }
            });
        } catch (e) {
            console.error("Validation error", e);
            throw e;
        }

        if (onProgress) onProgress(i + 1, totalBatches);
    }
    return invalid;
}