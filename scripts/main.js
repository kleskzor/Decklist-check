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

document.getElementById('fileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => parseCSV(evt.target.result);
    reader.readAsText(file);
});

window.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
});

loadState();
