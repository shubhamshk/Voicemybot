/**
 * Janitor Voice - Popup Script
 * Extension popup logic
 */

'use strict';

// Check if we're on a Janitor AI page
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    const statusEl = document.getElementById('status');

    if (currentTab && currentTab.url) {
        const url = currentTab.url.toLowerCase();
        const isJanitorAI = url.includes('janitorai.com');

        if (isJanitorAI) {
            statusEl.textContent = '✓ Ready on Janitor AI';
            statusEl.style.background = 'rgba(16, 185, 129, 0.1)';
            statusEl.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            statusEl.style.color = '#10b981';
        } else {
            statusEl.textContent = '⚠ Not on Janitor AI';
            statusEl.style.background = 'rgba(245, 158, 11, 0.1)';
            statusEl.style.borderColor = 'rgba(245, 158, 11, 0.3)';
            statusEl.style.color = '#f59e0b';
        }
    }
});

// Add click handler for the "Open Janitor AI" button
document.addEventListener('DOMContentLoaded', () => {
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: link.href });
        });
    });

    const showPanelBtn = document.getElementById('show-panel');
    if (showPanelBtn) {
        showPanelBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: 'SHOW_PANEL' });
                    window.close(); // Close popup
                }
            });
        });
    }
});
