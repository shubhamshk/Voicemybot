/**
 * Janitor Voice - Content Script
 * Production-quality Text-to-Speech for Janitor AI
 * 
 * Architecture:
 * - TTSEngine: Abstract interface for TTS providers
 * - WebSpeechTTS: Web Speech API implementation
 * - MessageDetector: MutationObserver-based message detection
 * - VoiceController: Main orchestrator
 * - UIPanel: Draggable control panel
 * - OverlayManager: Manages the floating overlay for buttons
 * - HighlightManager: Handles real-time text highlighting
 */

'use strict';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const CONFIG = {
  STORAGE_PREFIX: 'janitor_voice_',
  DEFAULTS: {
    enabled: true,
    rate: 1.0,
    pitch: 1.0,
    voiceURI: null,
    volume: 1.0
  },
  SELECTORS: {
    chatContainer: '[data-testid="virtuoso-scroller"], [data-testid="virtuoso-item-list"], main',
    characterMessage: 'li._messageDisplayWrapper_2xqwb_2, li[class*="_messageDisplayWrapper_"]',
    userMessage: '[class*="user"]',
    messageBody: '[class*="_messageBody_"]' // Specific selector for content
  },
  UI: {
    panelId: 'janitor-voice-panel',
    overlayId: 'janitor-voice-overlay',
    minWidth: 300,
    minHeight: 200
  },
  SPEECH: {
    queueDelay: 500
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const StorageManager = {
  get(key, defaultValue = null) {
    try {
      const stored = localStorage.getItem(CONFIG.STORAGE_PREFIX + key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch (error) {
      console.error('[Janitor Voice] Storage get error:', error);
      return defaultValue;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(CONFIG.STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('[Janitor Voice] Storage set error:', error);
      return false;
    }
  },
  loadSettings() {
    return {
      enabled: this.get('enabled', CONFIG.DEFAULTS.enabled),
      rate: this.get('rate', CONFIG.DEFAULTS.rate),
      pitch: this.get('pitch', CONFIG.DEFAULTS.pitch),
      voiceURI: this.get('voiceURI', CONFIG.DEFAULTS.voiceURI),
      volume: this.get('volume', CONFIG.DEFAULTS.volume)
    };
  }
};

// ============================================================================
// TTS ENGINE
// ============================================================================

class WebSpeechTTS {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.currentUtterance = null;
  }
  async initialize() {
    return new Promise((resolve) => {
      const load = () => {
        this.voices = this.synth.getVoices();
        if (this.voices.length > 0) resolve(true);
      };
      load();
      if (this.voices.length === 0) {
        this.synth.onvoiceschanged = load;
        setTimeout(() => resolve(true), 1000); // Fallback
      }
    });
  }

  // Updated speak method with onBoundary support
  speak(text, options = {}, onEnd, onBoundary) {
    this.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate || 1.0;
    utterance.pitch = options.pitch || 1.0;
    utterance.volume = options.volume || 1.0;
    if (options.voiceURI) {
      const voice = this.voices.find(v => v.voiceURI === options.voiceURI);
      if (voice) utterance.voice = voice;
    }

    this.currentUtterance = utterance;

    utterance.onend = () => {
      if (this.currentUtterance === utterance) {
        this.currentUtterance = null;
      }
      if (onEnd) onEnd();
    };

    utterance.onerror = (e) => {
      console.error('[Janitor Voice] Speech error', e);
      if (onEnd) onEnd();
    };

    if (onBoundary) {
      utterance.onboundary = onBoundary;
    }

    this.synth.speak(utterance);
  }

  cancel() {
    this.synth.cancel();
    this.currentUtterance = null;
  }

  pause() { this.synth.pause(); }
  resume() { this.synth.resume(); }
  isSpeaking() { return this.synth.speaking; }
  getVoices() { return this.voices; }
}

// ============================================================================
// HIGHLIGHT MANAGER (Fixed)
// ============================================================================

class HighlightManager {
  constructor() {
    this.originalHTML = null;
    this.activeElement = null;
    this.wordMap = [];
  }

  /**
   * Prepares element for highlighting
   */
  start(element, spokenText) {
    this.stop(); // Clear previous

    if (!element || !element.isConnected) {
      console.warn('[Janitor Voice] Highlighter: Invalid element');
      return;
    }

    // Find the container. Fallback to element itself if query fails.
    let contentBody = element.querySelector(CONFIG.SELECTORS.messageBody) ||
      element.querySelector('.message-body') ||
      element;

    // Use the first Paragraph container if available, as that's usually where text is
    const firstP = contentBody.querySelector('p');
    if (firstP && firstP.parentElement) {
      // Highlighting works best if we target the parent of the Ps
      // But if 'contentBody' contains other junk, we want to be careful.
      // For Janitor, usually contentBody contains <p>s
    }

    this.activeElement = contentBody;
    this.originalHTML = contentBody.innerHTML;

    console.log('[Janitor Voice] Highlighter started on:', this.activeElement);

    // Reset Map
    this.wordMap = [];
    let globalCharIndex = 0;

    // Helper: Wrap text nodes
    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        if (!text.trim()) {
          globalCharIndex += text.length; // Count invisible whitespace
          return;
        }

        const fragment = document.createDocumentFragment();
        // Split by space, keeping delimiters
        const parts = text.split(/(\s+)/);

        parts.forEach(part => {
          if (!part) return;

          if (part.trim().length === 0) {
            fragment.appendChild(document.createTextNode(part));
            globalCharIndex += part.length;
          } else {
            const span = document.createElement('span');
            span.textContent = part;
            span.className = 'jv-tts-word';
            // Store strict range
            this.wordMap.push({
              start: globalCharIndex,
              end: globalCharIndex + part.length,
              span: span
            });
            fragment.appendChild(span);
            globalCharIndex += part.length;
          }
        });
        node.replaceWith(fragment);

      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (['SCRIPT', 'STYLE', 'BUTTON'].includes(node.tagName)) return;

        // Recurse
        Array.from(node.childNodes).forEach(processNode);

        // If this was a block element (like P or DIV), likely a newline in spoken text
        if (node.tagName === 'P' || node.tagName === 'DIV' || node.tagName === 'BR') {
          // The spoken text joining logic usually adds '\n' between paragraphs
          // We need to account for this implied character in our index
          // Check if the SPOKEN TEXT actually had a newline here. 
          // Simple heuristic: add 1 for newline if not end
          if (globalCharIndex < spokenText.length) {
            // Only increment if we match the spoken text format '...text\nNext...'
            // This is tricky. Let's assume the join('\n') from MessageDetector is consistent.
            // The simplest way is to NOT increment here, but ensure MessageDetector
            // joins with ' ' or we handle loose matching.
            //
            // BETTER FIX: MessageDetector joins with '\n'.
            // So we must increment globalCharIndex by 1 between Ps
            globalCharIndex += 1;
          }
        }
      }
    };

    // Process top-level children to handle the P-gap logic correctly
    const children = Array.from(contentBody.childNodes);
    children.forEach((child, index) => {
      processNode(child);
      // Add newline offset between block elements (Paragraphs)
      if (child.tagName === 'P' && index < children.length - 1) {
        // Because processNode recurses, it might have already handled it?
        // No, processNode handles "inside".
        // The "\n" is "between" them in the source string.
        // BUT: I added generic block handling inside processNode (recursive).
        // Let's rely on that recursive check (node.tagName === 'P') above.
        // Wait, recursively, 'processNode' is called on the P element. 
        // It processes children. Then returns.
        // So the check `if (node.tagName === 'P')` at the end of `processNode` execution is correct.
      }
    });
  }

  highlight(charIndex) {
    if (!this.activeElement) return;

    // Fuzzy Match: 
    // Browsers often fire boundary events at slightly different indices than our DOM calculation
    // especially with special characters or emojis.
    // We look for a word that *contains* or is *closest* to the charIndex.

    // Strict Containment
    let match = this.wordMap.find(w => charIndex >= w.start && charIndex < w.end);

    // If no strict match (e.g. index is at a space between words), try next word
    if (!match) {
      match = this.wordMap.find(w => w.start >= charIndex);
    }

    // Cleanup previous
    const prev = this.activeElement.querySelector('.jv-tts-highlight');
    if (prev) prev.classList.remove('jv-tts-highlight');

    // Apply new
    if (match && match.span) {
      match.span.classList.add('jv-tts-highlight');
    }
  }

  stop() {
    if (this.activeElement && this.originalHTML) {
      this.activeElement.innerHTML = this.originalHTML;
    }
    this.activeElement = null;
    this.originalHTML = null;
    this.wordMap = [];
  }
}

// ============================================================================
// OVERLAY MANAGER
// ============================================================================

class OverlayManager {
  constructor() {
    this.overlay = null;
  }
  create() {
    if (document.getElementById(CONFIG.UI.overlayId)) return;
    this.overlay = document.createElement('div');
    this.overlay.id = CONFIG.UI.overlayId;
    document.body.appendChild(this.overlay);
  }
  get() {
    if (!this.overlay) this.create();
    return this.overlay;
  }
}

// ============================================================================
// MIC BUTTON INJECTOR
// ============================================================================

class MicButtonInjector {
  constructor(overlayManager, onInteraction) {
    this.overlayManager = overlayManager;
    this.onInteraction = onInteraction;
    this.items = new Map();
    this.rafId = null;
    this.startTracking();
  }

  inject(messageElement, text) {
    if (this.items.has(messageElement)) return;
    if (!messageElement.isConnected) return;

    const button = document.createElement('button');
    button.className = 'jv-mic-button';
    button.innerHTML = '🎤';
    button.setAttribute('aria-label', 'Play Voice');
    button.title = 'Speak Message';

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onInteraction(messageElement, text, button);
    });

    this.overlayManager.get().appendChild(button);
    this.items.set(messageElement, { button, text });
    this.updateSinglePosition(messageElement, button);
  }

  startTracking() {
    const loop = () => {
      this.updatePositions();
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  updatePositions() {
    const vH = window.innerHeight;
    const vW = window.innerWidth;
    for (const [element, item] of this.items) {
      this.updateSinglePosition(element, item.button, vH, vW);
    }
  }

  updateSinglePosition(element, button, vH, vW) {
    if (!element.isConnected) {
      button.style.display = 'none';
      if (!document.contains(element)) this.cleanup(element);
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > (vH || window.innerHeight)) {
      button.style.display = 'none';
      return;
    }
    button.style.display = 'flex';
    const top = rect.top + 10;
    const left = rect.right - 42;
    button.style.transform = `translate(${left}px, ${top}px)`;
  }

  cleanup(element) {
    const item = this.items.get(element);
    if (item) {
      item.button.remove();
      this.items.delete(element);
    }
  }

  setButtonState(button, state) {
    if (state === 'playing') {
      button.classList.add('is-playing');
      button.classList.remove('is-paused');
      button.innerHTML = '⏸';
    } else if (state === 'paused') {
      button.classList.add('is-paused');
      button.classList.remove('is-playing');
      button.innerHTML = '▶';
    } else {
      button.classList.remove('is-playing', 'is-paused');
      button.innerHTML = '🎤';
    }
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.items.forEach(item => item.button.remove());
    this.items.clear();
  }
}

// ============================================================================
// UI PANEL
// ============================================================================

class UIPanel {
  constructor(controller) {
    this.controller = controller;
    this.panel = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.isMinimized = false;
  }

  create() {
    if (document.getElementById(CONFIG.UI.panelId)) return;
    this.panel = document.createElement('div');
    this.panel.id = CONFIG.UI.panelId;
    this.panel.className = 'janitor-voice-panel';
    this.panel.innerHTML = `
      <div class="jv-header" id="jv-drag-handle">
        <div class="jv-title"><span class="jv-icon">🎤</span><span>Janitor Voice</span></div>
        <div class="jv-actions">
          <button class="jv-btn-minimize" id="jv-minimize">−</button>
          <button class="jv-btn-close" id="jv-close">×</button>
        </div>
      </div>
      <div class="jv-body" id="jv-body">
        <div class="jv-control">
          <label class="jv-toggle-label">
            <input type="checkbox" id="jv-toggle" />
            <span class="jv-toggle-slider"></span>
            <span class="jv-toggle-text">Enable Voice</span>
          </label>
        </div>
        <div class="jv-control">
          <label class="jv-label"><span>Speech Rate</span><span class="jv-value" id="jv-rate-value">1.0x</span></label>
          <input type="range" id="jv-rate" min="0.5" max="2" step="0.1" value="1" />
        </div>
        <div class="jv-control">
          <label class="jv-label"><span>Pitch</span><span class="jv-value" id="jv-pitch-value">1.0</span></label>
          <input type="range" id="jv-pitch" min="0.5" max="2" step="0.1" value="1" />
        </div>
        <div class="jv-control">
          <label class="jv-label">Voice</label>
          <select id="jv-voice" class="jv-select"></select>
        </div>
        <div class="jv-status" id="jv-status">Ready</div>
      </div>
    `;
    document.body.appendChild(this.panel);
    this.setupEventListeners();
    this.populateVoices();
    this.loadSettings();
  }

  setupEventListeners() {
    const header = this.panel.querySelector('#jv-drag-handle');
    header.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      const rect = this.panel.getBoundingClientRect();
      this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.panel.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      const x = Math.max(0, Math.min(e.clientX - this.dragOffset.x, window.innerWidth - this.panel.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - this.dragOffset.y, window.innerHeight - this.panel.offsetHeight));
      this.panel.style.left = x + 'px';
      this.panel.style.top = y + 'px';
    });
    document.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.panel.style.cursor = 'default';
    });

    this.panel.querySelector('#jv-toggle').addEventListener('change', (e) => {
      this.controller.setEnabled(e.target.checked);
      this.updateStatus();
    });
    const rateEl = this.panel.querySelector('#jv-rate');
    rateEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.panel.querySelector('#jv-rate-value').textContent = val.toFixed(1) + 'x';
      this.controller.setRate(val);
    });
    const pitchEl = this.panel.querySelector('#jv-pitch');
    pitchEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.panel.querySelector('#jv-pitch-value').textContent = val.toFixed(1);
      this.controller.setPitch(val);
    });
    this.panel.querySelector('#jv-voice').addEventListener('change', (e) => {
      this.controller.setVoice(e.target.value);
    });
    this.panel.querySelector('#jv-minimize').addEventListener('click', () => {
      this.isMinimized = !this.isMinimized;
      this.panel.querySelector('#jv-body').style.display = this.isMinimized ? 'none' : 'flex';
      this.panel.querySelector('#jv-minimize').textContent = this.isMinimized ? '+' : '−';
    });
    this.panel.querySelector('#jv-close').addEventListener('click', () => {
      this.panel.style.display = 'none';
    });
  }

  populateVoices() {
    const select = this.panel.querySelector('#jv-voice');
    const voices = this.controller.getVoices();
    select.innerHTML = '';
    const def = document.createElement('option');
    def.value = ''; def.textContent = 'Default Voice';
    select.appendChild(def);
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      select.appendChild(opt);
    });
  }

  loadSettings() {
    const settings = this.controller.getSettings();
    this.panel.querySelector('#jv-toggle').checked = settings.enabled;
    this.panel.querySelector('#jv-rate').value = settings.rate;
    this.panel.querySelector('#jv-rate-value').textContent = settings.rate.toFixed(1) + 'x';
    this.panel.querySelector('#jv-pitch').value = settings.pitch;
    this.panel.querySelector('#jv-pitch-value').textContent = settings.pitch.toFixed(1);
    if (settings.voiceURI) this.panel.querySelector('#jv-voice').value = settings.voiceURI;
    this.updateStatus();
  }

  updateStatus(msg) {
    const status = this.panel.querySelector('#jv-status');
    if (msg) status.textContent = msg;
    else {
      const enabled = this.controller.getSettings().enabled;
      status.textContent = enabled ? '✓ Voice Active' : 'Voice Disabled';
      status.className = 'jv-status ' + (enabled ? 'active' : 'inactive');
    }
  }
}

// ============================================================================
// MESSAGE DETECTOR
// ============================================================================

class MessageDetector {
  constructor(onNewMessage) {
    this.onNewMessage = onNewMessage;
    this.observer = null;
  }
  start() {
    const check = () => {
      const container = document.querySelector(CONFIG.SELECTORS.chatContainer) || document.body;
      if (!container) return;
      this.scan(container);
      this.observer = new MutationObserver((mutations) => {
        // Basic optimization: only scan if nodes added
        const hasNodes = mutations.some(m => m.addedNodes.length > 0);
        if (hasNodes) this.scan(container);
      });
      this.observer.observe(container, { childList: true, subtree: true });
    };
    if (!document.querySelector(CONFIG.SELECTORS.chatContainer)) setTimeout(check, 2000);
    else check();
  }
  scan(root) {
    const messages = root.querySelectorAll(CONFIG.SELECTORS.characterMessage);
    messages.forEach(msg => {
      const text = this.extractText(msg);
      if (text) this.onNewMessage(msg, text);
    });
  }
  extractText(element) {
    const paras = element.querySelectorAll('p');
    if (paras.length > 0) return Array.from(paras).map(p => p.textContent).join('\n');
    const clone = element.cloneNode(true);
    clone.querySelectorAll('button, script, style, ._messageControls_').forEach(el => el.remove());
    return clone.textContent.trim();
  }
}

// ============================================================================
// MAIN CONTROLLER
// ============================================================================

class VoiceController {
  constructor() {
    this.tts = new WebSpeechTTS();
    this.overlay = new OverlayManager();
    this.uiPanel = null;
    this.injector = null;
    this.detector = null;
    this.highlighter = new HighlightManager();
    this.settings = StorageManager.loadSettings();

    this.currentButton = null;
    this.playbackState = 'IDLE';
  }

  async init() {
    await this.tts.initialize();
    this.overlay.create();
    this.uiPanel = new UIPanel(this);
    this.uiPanel.create();

    this.injector = new MicButtonInjector(this.overlay, (element, text, button) => {
      this.handleInteraction(element, text, button);
    });

    this.detector = new MessageDetector((element, text) => {
      if (this.settings.enabled) {
        this.injector.inject(element, text);
      }
    });
    this.detector.start();

    document.addEventListener('visibilitychange', () => {
      if (this.playbackState === 'PLAYING' && document.hidden) {
        this.tts.pause();
      } else if (this.playbackState === 'PLAYING' && !document.hidden) {
        this.tts.resume();
      }
    });

    console.log('[Janitor Voice] v3.4 Initialized + Debug Stats');
  }

  handleInteraction(element, text, button) {
    if (this.currentButton === button) {
      if (this.playbackState === 'PLAYING') {
        this.tts.pause();
        this.setPlaybackState(button, 'PAUSED');
      } else if (this.playbackState === 'PAUSED') {
        this.tts.resume();
        this.setPlaybackState(button, 'PLAYING');
      } else {
        this.play(element, text, button);
      }
      return;
    }

    if (this.currentButton) {
      this.injector.setButtonState(this.currentButton, 'idle');
      this.tts.cancel();
      this.highlighter.stop();
    }

    this.play(element, text, button);
  }

  play(element, text, button) {
    this.currentButton = button;
    this.setPlaybackState(button, 'PLAYING');

    // START HIGHLIGHTING
    this.highlighter.start(element, text);

    this.tts.speak(text, {
      rate: this.settings.rate,
      pitch: this.settings.pitch,
      volume: this.settings.volume,
      voiceURI: this.settings.voiceURI
    },
      // onEnd
      () => {
        console.log('[Janitor Voice] Playback Ended');
        if (this.currentButton === button) {
          this.injector.setButtonState(button, 'idle');
          this.currentButton = null;
          this.playbackState = 'IDLE';
          this.uiPanel.updateStatus();
          this.highlighter.stop();
        }
      },
      // onBoundary
      (event) => {
        // Debug
        // console.log('Boundary:', event.name, event.charIndex);
        if (event.name === 'word') {
          this.highlighter.highlight(event.charIndex);
        }
      });
  }

  setPlaybackState(button, state) {
    this.playbackState = state;
    if (state === 'PAUSED') {
      this.injector.setButtonState(button, 'paused');
      this.uiPanel.updateStatus('⏸ Paused');
    } else if (state === 'PLAYING') {
      this.injector.setButtonState(button, 'playing');
      this.uiPanel.updateStatus('🔊 Speaking...');
    } else {
      this.injector.setButtonState(button, 'idle');
      this.highlighter.stop();
    }
  }

  // Settings API
  setEnabled(enabled) {
    this.settings.enabled = enabled;
    StorageManager.set('enabled', enabled);
    if (!enabled) {
      this.tts.cancel();
      this.currentButton = null;
      this.playbackState = 'IDLE';
      this.highlighter.stop();
      if (this.injector) this.injector.stop();
    } else {
      if (this.injector) this.injector.startTracking();
      if (this.detector) this.detector.scan(document.body);
    }
  }
  setRate(rate) { this.settings.rate = rate; StorageManager.set('rate', rate); }
  setPitch(pitch) { this.settings.pitch = pitch; StorageManager.set('pitch', pitch); }
  setVoice(voiceURI) { this.settings.voiceURI = voiceURI; StorageManager.set('voiceURI', voiceURI); }
  getSettings() { return this.settings; }
  getVoices() { return this.tts.getVoices(); }
}

if (!window.janitorVoiceLoaded) {
  window.janitorVoiceLoaded = true;
  const ctrl = new VoiceController();
  ctrl.init();
}
